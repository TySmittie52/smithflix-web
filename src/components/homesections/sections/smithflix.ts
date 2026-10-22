/**
 * Smithflix home rows:
 *   - the nightly AI playlists ("Because you watched…", seasonal picks, Family Movie Night, Hidden Gems)
 *   - "Not on Smithflix yet": AI picks of titles that aren't on the server, with a Request button
 *     (served by the Smithflix Hub at /api on the same site).
 */
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { ApiClient } from 'jellyfin-apiclient';

import cardBuilder from 'components/cardbuilder/cardBuilder';
import { getPortraitShape } from 'components/cardbuilder/utils/shape';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import toast from 'components/toast/toast';
import escapeHtml from 'escape-html';

import type { SectionContainerElement, SectionOptions } from './section';

const AI_PREFIX = 'Because you watched';
const AI_SEASONAL = [ 'Halloween Picks', 'Holiday Picks', 'Date Night Picks' ];
const AI_FAMILY = 'Family Movie Night';
const AI_GEMS = 'Hidden Gems';

export interface HubTitle {
    tmdbId: number
    type: 'movie' | 'tv'
    title: string
    year?: number | null
    overview?: string
    poster?: string | null
    reason?: string
    status?: string
}

const REQUESTED = [ 'requested', 'processing', 'partial', 'available' ];

function aiOrder(name: string) {
    if (name.startsWith(AI_PREFIX)) return 0;
    if (AI_SEASONAL.includes(name)) return 1;
    if (name === AI_FAMILY) return 2;
    if (name === AI_GEMS) return 3;
    return -1;
}

function rowHtml(title: string, enableOverflow: boolean) {
    let html = '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
    html += '<h2 class="sectionTitle sectionTitle-cards">' + escapeHtml(title) + '</h2>';
    html += '</div>';
    if (enableOverflow) {
        html += '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">';
        html += '<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x" data-monitor="markplayed"></div>';
        html += '</div>';
    } else {
        html += '<div is="emby-itemscontainer" class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x" data-monitor="markplayed"></div>';
    }
    return html;
}

/** One row per AI playlist, in the same order as the TV app. */
export function loadSmithflixAiRows(elem: HTMLElement, apiClient: ApiClient, options: SectionOptions) {
    const userId = apiClient.getCurrentUserId();
    return apiClient.getItems(userId, { IncludeItemTypes: 'Playlist', Recursive: true })
        .then(result => {
            const playlists = (result.Items || [])
                .filter(p => aiOrder(p.Name || '') >= 0)
                .sort((a, b) => aiOrder(a.Name || '') - aiOrder(b.Name || ''));
            elem.innerHTML = '';
            for (const playlist of playlists) {
                const section = document.createElement('div');
                section.className = 'verticalSection hide';
                section.innerHTML = rowHtml(playlist.Name || '', options.enableOverflow);
                elem.appendChild(section);

                const container = section.querySelector('.itemsContainer') as SectionContainerElement | null;
                if (!container) continue;
                container.fetchData = () => apiClient.getItems(userId, {
                    ParentId: playlist.Id,
                    Limit: 30,
                    Fields: 'PrimaryImageAspectRatio',
                    ImageTypeLimit: 1,
                    EnableImageTypes: 'Primary,Backdrop,Thumb'
                });
                container.getItemsHtml = (items: BaseItemDto[]) => cardBuilder.getCardsHtml({
                    items,
                    shape: getPortraitShape(options.enableOverflow),
                    showTitle: true,
                    showYear: true,
                    centerText: true,
                    overlayPlayButton: true,
                    lazy: true,
                    context: 'home',
                    allowBottomPadding: !options.enableOverflow
                });
                container.parentContainer = section;
            }
        })
        .catch(err => {
            console.warn('[Smithflix] AI rows failed', err);
            elem.innerHTML = '';
        });
}

/* ---------------- Smithflix Hub (requests) ---------------- */

export function hubFetch(apiClient: ApiClient, path: string, init: RequestInit = {}) {
    return fetch('/api' + path, {
        ...init,
        headers: {
            'Authorization': `MediaBrowser Token="${apiClient.accessToken()}"`,
            'Content-Type': 'application/json',
            ...(init.headers || {})
        }
    }).then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'Something went wrong.');
        return body;
    });
}

function cardHtml(t: HubTitle, i: number) {
    const requested = REQUESTED.includes(t.status || '');
    const img = t.poster ?
        `<img src="${escapeHtml(t.poster)}" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">` :
        `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:1em;text-align:center;font-weight:600">${escapeHtml(t.title)}</div>`;
    return `<button type="button" class="card overflowPortraitCard card-hoverable sfx-card" data-index="${i}" style="background:none;border:0;padding:0;color:inherit;text-align:center;cursor:pointer">
        <div class="cardBox cardBox-bottompadded">
            <div class="cardScalable" style="position:relative;padding-bottom:150%;overflow:hidden;background:rgba(255,255,255,.05)">
                ${img}
                <span class="sfx-badge${requested ? ' requested' : ''}">${requested ? 'REQUESTED' : 'REQUEST'}</span>
            </div>
            <div class="cardText cardTextCentered cardText-first"><bdi>${escapeHtml(t.title)}</bdi></div>
            <div class="cardText cardTextCentered cardText-secondary"><bdi>${t.year ?? ''}${t.year ? ' · ' : ''}${t.type === 'tv' ? 'Series' : 'Movie'}</bdi></div>
        </div>
    </button>`;
}

/** "Request this?" dialog, shared with the Requests page. */
export function showRequestDialog(apiClient: ApiClient, t: HubTitle, onDone?: (status: string) => void) {
    const requested = REQUESTED.includes(t.status || '');
    const dlg = dialogHelper.createDialog({ size: 'small', removeOnClose: true, scrollY: false }) as HTMLElement;
    dlg.classList.add('formDialog');
    dlg.innerHTML = `
        <div class="formDialogHeader">
            <button is="paper-icon-button-light" class="btnCancel autoSize" tabindex="-1" title="Close"><span class="material-icons close" aria-hidden="true"></span></button>
            <h3 class="formDialogHeaderTitle">${escapeHtml(t.title)}${t.year ? ' (' + t.year + ')' : ''}</h3>
        </div>
        <div class="formDialogContent" style="padding:1em 1.5em 1.5em">
            <div style="display:flex;gap:1.2em;align-items:flex-start;flex-wrap:wrap">
                ${t.poster ? `<img src="${escapeHtml(t.poster)}" alt="" style="width:9em;border-radius:.6em">` : ''}
                <div style="flex:1;min-width:14em">
                    ${t.reason ? `<p style="color:#E59DFF;margin-top:0">${escapeHtml(t.reason)}</p>` : ''}
                    <p style="opacity:.85">${escapeHtml(t.overview || 'No description available.')}</p>
                    <button is="emby-button" type="button" class="raised button-submit block btnRequest" ${requested ? 'disabled' : ''}>
                        <span>${requested ? 'Already requested' : (t.type === 'tv' ? 'Request series' : 'Request movie')}</span>
                    </button>
                </div>
            </div>
        </div>`;
    dlg.querySelector('.btnCancel')?.addEventListener('click', () => dialogHelper.close(dlg));
    const btn = dlg.querySelector('.btnRequest') as HTMLButtonElement | null;
    btn?.addEventListener('click', () => {
        btn.disabled = true;
        hubFetch(apiClient, '/request', { method: 'POST', body: JSON.stringify({ type: t.type, tmdbId: t.tmdbId }) })
            .then(res => {
                toast(res.message || 'Requested!');
                onDone?.('requested');
                dialogHelper.close(dlg);
            })
            .catch(err => {
                toast(err.message);
                btn.disabled = false;
            });
    });
    dialogHelper.open(dlg);
}

export function renderHubCards(container: HTMLElement, apiClient: ApiClient, titles: HubTitle[], onRequested?: () => void) {
    container.innerHTML = titles.map(cardHtml).join('');
    container.querySelectorAll<HTMLButtonElement>('.sfx-card').forEach(card => {
        card.addEventListener('click', () => {
            const t = titles[Number(card.dataset.index)];
            showRequestDialog(apiClient, t, status => {
                t.status = status;
                const badge = card.querySelector('.sfx-badge');
                if (badge) {
                    badge.textContent = 'REQUESTED';
                    badge.classList.add('requested');
                }
                onRequested?.();
            });
        });
    });
}

/** "Not on Smithflix yet" row. */
export function loadSmithflixSuggestions(elem: HTMLElement, apiClient: ApiClient, options: SectionOptions) {
    return hubFetch(apiClient, '/suggestions')
        .then(body => {
            const titles: HubTitle[] = body.results || [];
            if (!titles.length) {
                elem.innerHTML = '';
                return;
            }
            let html = '<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">';
            html += '<a href="#/requests" class="button-flat button-flat-mini sectionTitleTextButton" style="text-decoration:none">';
            html += '<h2 class="sectionTitle sectionTitle-cards">Not on SyncWave TV yet</h2>';
            html += '<span class="material-icons chevron_right" aria-hidden="true"></span></a></div>';
            html += options.enableOverflow ?
                '<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true"><div class="itemsContainer scrollSlider focuscontainer-x sfx-items"></div></div>' :
                '<div class="itemsContainer padded-left padded-right vertical-wrap focuscontainer-x sfx-items"></div>';
            elem.innerHTML = html;
            elem.classList.remove('hide');
            const container = elem.querySelector('.sfx-items') as HTMLElement | null;
            if (container) renderHubCards(container, apiClient, titles);
        })
        .catch(err => {
            console.warn('[Smithflix] suggestions unavailable', err);
            elem.innerHTML = '';
        });
}
