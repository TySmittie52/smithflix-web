/**
 * Smithflix TV (web): channels built into Smithflix.
 *
 * A channel isn't a live stream. The Smithflix Hub keeps a clock-based schedule, and tuning in
 * plays the scheduled title itself, jumped to the right spot, with the next programs queued
 * behind it. That's why channels start as fast as a movie.
 *
 * Channel watching shouldn't count as "watched": before playing, we remember each queued
 * title's watched state and put it back when the channel is turned off.
 */
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import { PlaybackSubscriber } from 'apps/legacy/features/playback/utils/playbackSubscriber';
import { playbackManager } from 'components/playback/playbackmanager';
import type { PlayerState } from 'types/playbackStopInfo';
import { hubFetch } from 'components/homesections/sections/smithflix';
import toast from 'components/toast/toast';
import Events from 'utils/events';

export interface TvChannel {
    key: string
    name: string
    number: number
    logo: string | null
}

export interface TvProgram {
    start: number
    end: number
    itemId: string
    seriesId?: string | null
    title: string
    subtitle: string
    rating: string
    /** End credits, in seconds into the episode; skipped while watching a channel. */
    creditsStart?: number
    creditsEnd?: number
}

export interface TvGuide {
    serverTime: number
    start: number
    end: number
    channels: { key: string, programs: TvProgram[] }[]
}

export const getChannels = (apiClient: ApiClient): Promise<{ serverTime: number, channels: TvChannel[] }> =>
    hubFetch(apiClient, '/tv/channels');

export const getGuide = (apiClient: ApiClient, start: number, hours: number): Promise<TvGuide> =>
    hubFetch(apiClient, `/tv/guide?start=${Math.floor(start)}&hours=${hours}`);

interface Tune {
    serverTime: number
    channel: string
    offset: number
    program: TvProgram
    next: TvProgram[]
}

interface SavedUserData {
    Played?: boolean
    PlaybackPositionTicks?: number
    PlayCount?: number
    LastPlayedDate?: string | null
}

const TICKS_PER_SECOND = 10_000_000;
let saved: Record<string, SavedUserData> = {};
let currentChannel: string | null = null;
/** Credits (start, end in seconds) of the programs queued from the current channel, by item id. */
let credits: Record<string, [number, number]> = {};
let restoreTimer: number | undefined;

export const getCurrentChannel = () => currentChannel;

async function restoreWatchedState(apiClient: ApiClient) {
    const entries = Object.entries(saved);
    saved = {};
    currentChannel = null;
    credits = {};
    const userId = apiClient.getCurrentUserId();
    for (const [itemId, data] of entries) {
        try {
            await fetch(`${apiClient.serverAddress()}/UserItems/${itemId}/UserData?userId=${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `MediaBrowser Token="${apiClient.accessToken()}"`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    Played: !!data.Played,
                    PlaybackPositionTicks: data.PlaybackPositionTicks || 0,
                    PlayCount: data.PlayCount || 0,
                    ...(data.LastPlayedDate ? { LastPlayedDate: data.LastPlayedDate } : {})
                })
            });
        } catch (err) {
            console.warn('[Smithflix TV] could not restore watched state for', itemId, err);
        }
    }
}

function onPlaybackStop(apiClient: ApiClient) {
    // Wait for Jellyfin to finish recording the stop, then put the watched state back.
    window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(() => {
        if (!playbackManager.isPlaying()) {
            Events.off(playbackManager, 'playbackstop', stopHandler);
            void restoreWatchedState(apiClient);
        }
    }, 2500);
}

let stopHandler: () => void = () => undefined;

/** Tune in: play what's on the channel right now from the right spot, with the next programs queued. */
export async function tuneChannel(apiClient: ApiClient, channelKey: string) {
    let tune: Tune;
    try {
        tune = await hubFetch(apiClient, `/tv/tune?channel=${encodeURIComponent(channelKey)}`);
    } catch (err) {
        toast((err as Error).message);
        return;
    }

    const programs = [ tune.program, ...tune.next ];
    const ids = programs.map(p => p.itemId);
    const userId = apiClient.getCurrentUserId();
    const result = await apiClient.getItems(userId, {
        Ids: ids.join(','),
        Fields: 'MediaSources,Chapters,Path'
    });
    const byId = new Map((result.Items || []).map((i: BaseItemDto) => [ i.Id, i ]));
    const items = ids.map(id => byId.get(id)).filter(Boolean) as BaseItemDto[];
    if (!items.length) {
        toast("That channel's show isn't available right now.");
        return;
    }

    // If a previous channel is still playing, its saved state is restored after it stops.
    for (const item of items) {
        if (item.Id && !(item.Id in saved)) {
            const ud = item.UserData;
            saved[item.Id] = {
                Played: ud?.Played,
                PlaybackPositionTicks: ud?.PlaybackPositionTicks,
                PlayCount: ud?.PlayCount ?? undefined,
                LastPlayedDate: ud?.LastPlayedDate
            };
        }
    }
    currentChannel = channelKey;
    credits = {};
    for (const p of programs) {
        if (p.creditsStart != null && p.creditsEnd != null) credits[p.itemId] = [ p.creditsStart, p.creditsEnd ];
    }
    bindCreditsSkipper();

    // Account for the time it took to load (the offset was measured on the hub).
    const elapsed = Math.max(0, Date.now() / 1000 - tune.serverTime);
    const offsetSeconds = items[0].Id === tune.program.itemId ? tune.offset + elapsed : 0;

    Events.off(playbackManager, 'playbackstop', stopHandler);
    stopHandler = () => onPlaybackStop(apiClient);
    Events.on(playbackManager, 'playbackstop', stopHandler);

    await playbackManager.play({
        items,
        serverId: apiClient.serverId(),
        startPositionTicks: Math.floor(offsetSeconds * TICKS_PER_SECOND),
        fullscreen: true
    });
}

/**
 * Skips the end credits of channel episodes. The schedule leaves them out of each program's
 * slot, so skipping keeps the channel on time: credits that run to the end of the episode go
 * straight to the next show, otherwise playback jumps to the scene after the credits.
 */
class ChannelCreditsSkipper extends PlaybackSubscriber {
    private window: [number, number] | null = null;
    private runtime = 0;
    private lastTime = -1;
    private done = false;

    onPlayerPlaybackStart(_e: unknown, state: PlayerState) {
        const id = state.NowPlayingItem?.Id;
        this.window = currentChannel && id ? credits[id] || null : null;
        this.runtime = (state.NowPlayingItem?.RunTimeTicks || 0) / TICKS_PER_SECOND;
        this.lastTime = -1;
        this.done = false;
    }

    onPlayerTimeUpdate() {
        if (!this.window || this.done || !currentChannel) return;
        const time = this.playbackManager.currentTime(this.player) / 1000;
        const [ start, end ] = this.window;
        // only when playback runs into the credits (not when tuning in after them)
        if (this.lastTime >= 0 && this.lastTime < start && time >= start && time < end) {
            this.done = true;
            if (!this.runtime || end >= this.runtime - 2) {
                console.debug('[SyncWave TV] credits: on to the next show');
                this.playbackManager.nextTrack(this.player);
            } else {
                console.debug('[SyncWave TV] credits: jumping to %s s', end);
                this.playbackManager.seek(Math.floor(end * TICKS_PER_SECOND), this.player);
            }
        }
        this.lastTime = time;
    }
}

let creditsSkipper: ChannelCreditsSkipper | undefined;
function bindCreditsSkipper() {
    if (!creditsSkipper) creditsSkipper = new ChannelCreditsSkipper(playbackManager);
}
