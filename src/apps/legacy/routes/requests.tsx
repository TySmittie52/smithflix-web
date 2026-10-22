import React, { type FC, useCallback, useEffect, useRef, useState } from 'react';

import Page from 'components/Page';
import {
    type HubTitle,
    hubFetch,
    renderHubCards
} from 'components/homesections/sections/smithflix';
import ServerConnections from 'lib/jellyfin-apiclient/ServerConnections';

interface MyRequest extends HubTitle {
    request: 'pending' | 'approved' | 'declined' | 'failed' | 'completed'
}

const REQUEST_LABEL: Record<string, string> = {
    pending: 'Waiting for approval',
    approved: 'Approved · downloading',
    declined: 'Declined',
    failed: 'Failed',
    completed: 'On SyncWave TV'
};

const REQUEST_COLOR: Record<string, string> = {
    pending: '#FFB547',
    approved: '#1C8CFF',
    declined: '#FF5C5C',
    failed: '#FF5C5C',
    completed: '#3DDC97'
};

const Section: FC<{ title: string, hint?: string, children: React.ReactNode }> = ({ title, hint, children }) => (
    <div className='verticalSection' style={{ marginBottom: '2em' }}>
        <div className='sectionTitleContainer padded-left'>
            <h2 className='sectionTitle'>{title}</h2>
        </div>
        {hint && <p className='padded-left' style={{ opacity: 0.7, marginTop: 0 }}>{hint}</p>}
        {children}
    </div>
);

/** Smithflix Requests: search for anything, request it, and see your requests and the AI's picks. */
const Requests: FC = () => {
    const apiClient = ServerConnections.currentApiClient();
    const [ query, setQuery ] = useState('');
    const [ searching, setSearching ] = useState(false);
    const [ searchError, setSearchError ] = useState('');
    const [ suggestCount, setSuggestCount ] = useState<number | null>(null);
    const [ mine, setMine ] = useState<MyRequest[]>([]);
    const [ problem, setProblem ] = useState('');
    const resultsRef = useRef<HTMLDivElement>(null);
    const suggestRef = useRef<HTMLDivElement>(null);

    const loadMine = useCallback(() => {
        if (!apiClient) return;
        hubFetch(apiClient, '/requests')
            .then(body => setMine(body.results || []))
            .catch(err => setProblem(err.message));
    }, [ apiClient ]);

    useEffect(() => {
        if (!apiClient) return;
        hubFetch(apiClient, '/suggestions')
            .then(body => {
                const titles: HubTitle[] = body.results || [];
                setSuggestCount(titles.length);
                if (suggestRef.current) renderHubCards(suggestRef.current, apiClient, titles, loadMine);
            })
            .catch(err => {
                setSuggestCount(0);
                setProblem(err.message);
            });
        loadMine();
    }, [ apiClient, loadMine ]);

    useEffect(() => {
        const q = query.trim();
        if (!apiClient || q.length < 2) {
            if (resultsRef.current) resultsRef.current.innerHTML = '';
            setSearchError('');
            return;
        }
        const timer = setTimeout(() => {
            setSearching(true);
            hubFetch(apiClient, '/search?q=' + encodeURIComponent(q))
                .then(body => {
                    const titles: HubTitle[] = body.results || [];
                    setSearchError(titles.length ? '' : 'Nothing found. Try a different spelling.');
                    if (resultsRef.current) renderHubCards(resultsRef.current, apiClient, titles, loadMine);
                })
                .catch(err => setSearchError(err.message))
                .finally(() => setSearching(false));
        }, 450);
        return () => clearTimeout(timer);
    }, [ apiClient, query, loadMine ]);

    return (
        <Page
            id='smithflixRequestsPage'
            title='Requests'
            className='mainAnimatedPage libraryPage noSecondaryNavPage'
        >
            <div className='padded-top' style={{ paddingBottom: '3em' }}>
                {problem && (
                    <p className='padded-left padded-right' style={{ color: '#FFB547' }}>{problem}</p>
                )}

                <Section
                    title='Request a movie or show'
                    hint="Search for anything. If it isn't on SyncWave TV yet, request it and it'll be added."
                >
                    <div className='padded-left padded-right' style={{ maxWidth: '40em' }}>
                        <input
                            id='smithflixRequestSearch'
                            type='search'
                            className='emby-input'
                            placeholder='Search movies and shows'
                            autoComplete='off'
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            style={{ fontSize: '1.2em', padding: '.6em .9em', borderRadius: '10px', width: '100%' }}
                        />
                        {searching && <p style={{ opacity: 0.7 }}>Searching…</p>}
                        {searchError && <p style={{ opacity: 0.8 }}>{searchError}</p>}
                    </div>
                    <div ref={resultsRef} className='itemsContainer padded-left padded-right vertical-wrap' style={{ marginTop: '1em' }} />
                </Section>

                <Section
                    title='Not on SyncWave TV yet'
                    hint={suggestCount === 0 ? 'Your picks appear here after the nightly AI run.' : 'Picked for you each night by the SyncWave TV AI.'}
                >
                    <div ref={suggestRef} className='itemsContainer padded-left padded-right vertical-wrap' />
                </Section>

                <Section title='Your requests' hint={mine.length ? undefined : "You haven't requested anything yet."}>
                    <div className='padded-left padded-right' style={{ display: 'grid', gap: '.6em', maxWidth: '48em' }}>
                        {mine.map(r => (
                            <div
                                key={`${r.type}-${r.tmdbId}`}
                                style={{ display: 'flex', alignItems: 'center', gap: '1em', padding: '.6em', borderRadius: '12px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)' }}
                            >
                                {r.poster ? (
                                    <img src={r.poster} alt='' style={{ width: '3.2em', borderRadius: '.4em' }} />
                                ) : null}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600 }}>{r.title}{r.year ? ` (${r.year})` : ''}</div>
                                    <div style={{ opacity: 0.7, fontSize: '.9em' }}>{r.type === 'tv' ? 'Series' : 'Movie'}</div>
                                </div>
                                <span style={{ fontSize: '.85em', fontWeight: 600, color: REQUEST_COLOR[r.request] || '#ccc' }}>
                                    {REQUEST_LABEL[r.request] || r.request}
                                </span>
                            </div>
                        ))}
                    </div>
                </Section>
            </div>
        </Page>
    );
};

export default Requests;
