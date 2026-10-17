import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Page from 'components/Page';
import {
    getChannels,
    getGuide,
    type TvChannel,
    type TvGuide,
    type TvProgram,
    tuneChannel
} from 'components/smithflixTv/smithflixTv';
import ServerConnections from 'lib/jellyfin-apiclient/ServerConnections';

/** Smithflix TV guide (web): channels built into Smithflix, with a live preview of the focused channel. */

const PX_PER_MIN = 6;
const WINDOW_HOURS = 6;
const ROW_H = 64;
const LABEL_W = 170;

const fmtTime = (epoch: number) =>
    new Date(epoch * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const CSS = `
#smithflixTvPage .sfxtv-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.5em;align-items:start;padding:1em 3.3% 1.2em}
#smithflixTvPage .sfxtv-info h1{margin:.1em 0 .2em;font-size:1.9em;font-weight:700;letter-spacing:.01em}
#smithflixTvPage .sfxtv-info .sub{opacity:.8;font-size:1.05em}
#smithflixTvPage .sfxtv-info .meta{display:flex;gap:.8em;align-items:center;margin-top:.7em;opacity:.85;font-variant-numeric:tabular-nums}
#smithflixTvPage .sfxtv-chip{border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:0 .45em;font-size:.85em}
#smithflixTvPage .sfxtv-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin-top:.9em;max-width:28em;overflow:hidden}
#smithflixTvPage .sfxtv-bar>i{display:block;height:100%;background:linear-gradient(90deg,#1C8CFF,#0FE6FF)}
#smithflixTvPage .sfxtv-watch{margin-top:1.1em}
#smithflixTvPage .sfxtv-preview{width:min(400px,38vw);aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.12);position:relative}
#smithflixTvPage .sfxtv-preview video,#smithflixTvPage .sfxtv-preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#smithflixTvPage .sfxtv-preview .live{position:absolute;top:.6em;left:.6em;background:#e53935;color:#fff;font-size:.7em;font-weight:700;letter-spacing:.08em;padding:.1em .5em;border-radius:4px}
#smithflixTvPage .sfxtv-grid{overflow:auto;margin:0 3.3% 2em;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(13,20,36,.55);max-height:calc(100vh - 21em)}
#smithflixTvPage .sfxtv-inner{position:relative}
#smithflixTvPage .sfxtv-times{position:sticky;top:0;z-index:3;display:flex;height:34px;background:rgba(9,12,20,.92);backdrop-filter:blur(10px)}
#smithflixTvPage .sfxtv-times .corner{position:sticky;left:0;z-index:4;flex:none;background:rgba(9,12,20,.98)}
#smithflixTvPage .sfxtv-times .tick{position:absolute;top:0;height:34px;line-height:34px;padding-left:.6em;font-size:.85em;opacity:.75;border-left:1px solid rgba(255,255,255,.08);font-variant-numeric:tabular-nums}
#smithflixTvPage .sfxtv-row{display:flex;height:${ROW_H}px;border-top:1px solid rgba(255,255,255,.06)}
#smithflixTvPage .sfxtv-label{position:sticky;left:0;z-index:2;flex:none;display:flex;align-items:center;gap:.6em;padding:0 .7em;background:rgba(9,12,20,.96);border-right:1px solid rgba(255,255,255,.08)}
#smithflixTvPage .sfxtv-label img{height:40px;width:80px;object-fit:contain}
#smithflixTvPage .sfxtv-label .num{opacity:.6;font-variant-numeric:tabular-nums;width:1.6em;text-align:right}
#smithflixTvPage .sfxtv-label .name{font-weight:600;font-size:.9em}
#smithflixTvPage .sfxtv-track{position:relative;flex:none}
#smithflixTvPage .sfxtv-prog{position:absolute;top:5px;bottom:5px;border-radius:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);color:inherit;text-align:left;padding:.35em .7em;overflow:hidden;cursor:pointer;font:inherit}
#smithflixTvPage .sfxtv-prog.on{background:rgba(28,140,255,.16);border-color:rgba(28,140,255,.35)}
#smithflixTvPage .sfxtv-prog:hover,#smithflixTvPage .sfxtv-prog:focus{outline:none;background:rgba(28,140,255,.32);box-shadow:0 0 0 2px #1C8CFF inset}
#smithflixTvPage .sfxtv-prog .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.92em}
#smithflixTvPage .sfxtv-prog .s{opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.8em}
#smithflixTvPage .sfxtv-now{position:absolute;top:0;bottom:0;width:2px;background:#0FE6FF;box-shadow:0 0 8px #0FE6FF;z-index:1;pointer-events:none}
#smithflixTvPage .sfxtv-msg{padding:2em 3.3%;opacity:.8}
@media (max-width:700px){#smithflixTvPage .sfxtv-hero{grid-template-columns:1fr}#smithflixTvPage .sfxtv-preview{width:100%}}
`;

const Tv: FC = () => {
    const apiClient = ServerConnections.currentApiClient();
    const [ channels, setChannels ] = useState<TvChannel[]>([]);
    const [ guide, setGuide ] = useState<TvGuide | null>(null);
    const [ problem, setProblem ] = useState('');
    const [ now, setNow ] = useState(() => Date.now() / 1000);
    const [ focus, setFocus ] = useState<{ channel: TvChannel, program: TvProgram } | null>(null);
    const [ previewFailed, setPreviewFailed ] = useState(false);
    const [ previewItem, setPreviewItem ] = useState<{ program: TvProgram, offset: number } | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    const windowStart = useMemo(() => Math.floor((Date.now() / 1000 - 1800) / 1800) * 1800, []);

    const load = useCallback(() => {
        if (!apiClient) return;
        Promise.all([ getChannels(apiClient), getGuide(apiClient, windowStart, WINDOW_HOURS) ])
            .then(([ ch, g ]) => {
                setChannels(ch.channels);
                setGuide(g);
                setProblem('');
            })
            .catch(err => setProblem((err as Error).message));
    }, [ apiClient, windowStart ]);

    useEffect(() => {
        load();
        const tick = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
        const refresh = window.setInterval(load, 10 * 60_000);
        return () => {
            window.clearInterval(tick);
            window.clearInterval(refresh);
        };
    }, [ load ]);

    const programsByKey = useMemo(() => {
        const m = new Map<string, TvProgram[]>();
        guide?.channels.forEach(c => m.set(c.key, c.programs));
        return m;
    }, [ guide ]);

    const onNow = useCallback((key: string) =>
        (programsByKey.get(key) || []).find(p => p.start <= now && now < p.end), [ programsByKey, now ]);

    // Start focused on the first channel
    useEffect(() => {
        if (!focus && channels.length) {
            const p = onNow(channels[0].key);
            if (p) setFocus({ channel: channels[0], program: p });
        }
    }, [ channels, focus, onNow ]);

    // Live preview: what's on the focused channel right now (after a short pause)
    useEffect(() => {
        if (!focus) return;
        const current = onNow(focus.channel.key);
        setPreviewFailed(false);
        setPreviewItem(null);
        if (!current) return;
        const t = window.setTimeout(() => setPreviewItem({ program: current, offset: Date.now() / 1000 - current.start }), 900);
        return () => window.clearTimeout(t);
    }, [ focus?.channel.key, onNow ]); // eslint-disable-line react-hooks/exhaustive-deps

    // Scroll so "now" is near the left edge
    useEffect(() => {
        if (guide && gridRef.current) gridRef.current.scrollLeft = Math.max(0, (now - windowStart) / 60 * PX_PER_MIN - 120);
    }, [ guide ]); // eslint-disable-line react-hooks/exhaustive-deps

    const trackW = WINDOW_HOURS * 60 * PX_PER_MIN;
    const x = (t: number) => (t - windowStart) / 60 * PX_PER_MIN;
    const server = apiClient?.serverAddress();
    const token = apiClient?.accessToken();

    const previewSrc = previewItem && server && token ?
        `${server}/Videos/${previewItem.program.itemId}/stream?static=true&ApiKey=${token}#t=${Math.floor(previewItem.offset)}` : null;
    const previewImg = focus && server ?
        `${server}/Items/${focus.program.seriesId || focus.program.itemId}/Images/Backdrop?maxWidth=800` : null;

    const fp = focus?.program;
    const airing = fp && fp.start <= now && now < fp.end;

    return (
        <Page id='smithflixTvPage' title='TV Guide' className='mainAnimatedPage libraryPage noSecondaryNavPage'>
            <style>{CSS}</style>
            {problem && <div className='sfxtv-msg'>{problem}</div>}
            {!problem && !guide && <div className='sfxtv-msg'>Loading the guide…</div>}

            {guide && (
                <>
                    <div className='sfxtv-hero'>
                        <div className='sfxtv-info'>
                            {focus && fp && (
                                <>
                                    <div style={{ opacity: 0.7 }}>{focus.channel.number} · {focus.channel.name}</div>
                                    <h1>{fp.title}</h1>
                                    {fp.subtitle && <div className='sub'>{fp.subtitle}</div>}
                                    <div className='meta'>
                                        <span>{fmtTime(fp.start)} – {fmtTime(fp.end)}</span>
                                        {fp.rating && <span className='sfxtv-chip'>{fp.rating}</span>}
                                    </div>
                                    {airing && (
                                        <div className='sfxtv-bar'><i style={{ width: `${Math.min(100, (now - fp.start) / (fp.end - fp.start) * 100)}%` }} /></div>
                                    )}
                                    {airing && apiClient && (
                                        <button
                                            id='smithflixTvWatch'
                                            type='button'
                                            className='raised button-submit sfxtv-watch'
                                            onClick={() => void tuneChannel(apiClient, focus.channel.key)}
                                        >
                                            <span>Watch {focus.channel.name}</span>
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                        <div className='sfxtv-preview'>
                            {previewImg && <img src={previewImg} alt='' onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                            {previewSrc && !previewFailed && (
                                <video
                                    key={previewSrc}
                                    src={previewSrc}
                                    muted
                                    autoPlay
                                    playsInline
                                    onError={() => setPreviewFailed(true)}
                                />
                            )}
                            {airing && <span className='live'>LIVE</span>}
                        </div>
                    </div>

                    <div className='sfxtv-grid' ref={gridRef}>
                        <div className='sfxtv-inner' style={{ width: LABEL_W + trackW }}>
                            <div className='sfxtv-times'>
                                <div className='corner' style={{ width: LABEL_W }} />
                                <div style={{ position: 'relative', width: trackW }}>
                                    {Array.from({ length: WINDOW_HOURS * 2 }, (_, i) => windowStart + i * 1800).map(t => (
                                        <div key={t} className='tick' style={{ left: x(t), width: 30 * PX_PER_MIN }}>{fmtTime(t)}</div>
                                    ))}
                                </div>
                            </div>
                            {channels.map(ch => (
                                <div key={ch.key} className='sfxtv-row'>
                                    <div className='sfxtv-label' style={{ width: LABEL_W }}>
                                        <span className='num'>{ch.number}</span>
                                        {ch.logo ? <img src={ch.logo} alt={ch.name} /> : <span className='name'>{ch.name}</span>}
                                    </div>
                                    <div className='sfxtv-track' style={{ width: trackW }}>
                                        {(programsByKey.get(ch.key) || []).map(p => {
                                            const left = Math.max(0, x(p.start));
                                            const right = Math.min(trackW, x(p.end));
                                            if (right - left < 2) return null;
                                            const isOn = p.start <= now && now < p.end;
                                            return (
                                                <button
                                                    key={`${p.itemId}-${p.start}`}
                                                    type='button'
                                                    className={'sfxtv-prog' + (isOn ? ' on' : '')}
                                                    style={{ left: left + 2, width: right - left - 4 }}
                                                    onFocus={() => setFocus({ channel: ch, program: p })}
                                                    onMouseEnter={() => setFocus({ channel: ch, program: p })}
                                                    onClick={() => {
                                                        if (isOn && apiClient) void tuneChannel(apiClient, ch.key);
                                                        else setFocus({ channel: ch, program: p });
                                                    }}
                                                    title={isOn ? `Watch ${ch.name}` : `${p.title} at ${fmtTime(p.start)}`}
                                                >
                                                    <div className='t'>{p.title}</div>
                                                    <div className='s'>{fmtTime(p.start)}{p.subtitle ? ` · ${p.subtitle}` : ''}</div>
                                                </button>
                                            );
                                        })}
                                        {now >= windowStart && now <= windowStart + WINDOW_HOURS * 3600 && (
                                            <div className='sfxtv-now' style={{ left: x(now) }} />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </Page>
    );
};

export default Tv;
