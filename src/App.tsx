import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppController } from './controller';
import { copy, type Copy } from './copy';
import { recommendations } from './engine';
import { Gallery, RemoteImage } from './Gallery';
import { Icon } from './icons';
import type { Booth, Language, Page, Snapshot } from './types';

const pageFromHash = (): Page => {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash === 'saved' || hash === 'recommendations' ? hash : 'discover';
};

function Fandoms({ booth, snapshot, t, matching }: { booth: Booth; snapshot: Snapshot; t: Copy; matching?: number[] }) {
  const [expanded, setExpanded] = useState(false);
  const names = new Map(snapshot.fandoms.map(f => [f.id, f.name]));
  const ids = matching ?? booth.fandomIds;
  if (!ids.length) return null;
  return <div className="fandom-section">
    <span className="mini-label">{matching ? t.match : t.fandoms}</span>
    <div className="fandom-tags">{(expanded ? ids : ids.slice(0, 5)).map((id, i) => <span className={`fandom-tag tag-${i % 4}`} key={id}>{names.get(id) ?? id}</span>)}
      {ids.length > 5 && <button className="fandom-tag tag-more" aria-expanded={expanded} aria-label={expanded ? t.less : t.moreFandoms} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : `+${ids.length - 5}`}</button>}
    </div>
  </div>;
}

function Location({ booth, t, language }: { booth: Booth; t: Copy; language: Language }) {
  const dates = booth.days.map(day => {
    if (day === '2026-10-31') return t.day1;
    if (day === '2026-11-01') return t.day2;
    const date = new Date(`${day}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? day : new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  });
  return <div className="location-row"><span className="booth-location"><Icon name="pin" size={16}/>{booth.spaces.join(' / ') || '—'}</span>{dates.length > 0 && <span className="attendance">{dates.join(' · ')}</span>}</div>;
}

function Empty({ icon = 'sparkle', title, body, children }: { icon?: string; title: string; body: string; children?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol"><Icon name={icon} size={38}/></div><h2>{title}</h2><p>{body}</p>{children}</div>;
}

function Detail({ booth, snapshot, t, language, saved, toggle, close }: { booth: Booth; snapshot: Snapshot; t: Copy; language: Language; saved: boolean; toggle: () => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="detail-dialog" ref={dialog} onCancel={close} onClose={close} aria-label={booth.name} onClick={e => { if (e.target === dialog.current) close(); }}>
    <div className="detail-toolbar"><span className="mini-label">CIRCLE CRUSH</span><button className="icon-button" onClick={close} aria-label={t.close}><Icon name="close"/></button></div>
    <Gallery booth={booth} t={t} fullscreen/>
    <div className="detail-body"><h2>{booth.name}</h2><Location booth={booth} t={t} language={language}/><Fandoms booth={booth} snapshot={snapshot} t={t}/>
      <div className="detail-actions"><button className={`primary-button ${saved ? 'is-saved' : ''}`} onClick={toggle}><Icon name={saved ? 'check' : 'bookmark'}/>{saved ? t.unsave : t.save}</button>{booth.catalogUrl && <a href={booth.catalogUrl} target="_blank" rel="noreferrer" className="source-link">{t.source}<Icon name="external" size={15}/></a>}</div>
    </div>
  </dialog>;
}

export default function App({ controller }: { controller: AppController }) {
  const { visitor, snapshot, loading, error, generating, generationError, generationErrorDetail } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const language = visitor.language, t: Copy = copy[language];
  const [page, setPage] = useState<Page>(pageFromHash);
  const [detail, setDetail] = useState<Booth>();
  const [limit, setLimit] = useState(20);
  const [fandomFilter, setFandomFilter] = useState<number>();
  const [acting, setActing] = useState(false);
  const current = visitor.batches[0]?.[0]?.booth;
  const next = visitor.batches.flat()[1]?.booth.gallery[0];
  const ranked = useMemo(() => snapshot ? recommendations(snapshot, visitor.decisions) : [], [snapshot, visitor.decisions]);
  const activeDetail = detail && (snapshot?.booths.find(b => b.id === detail.id) ?? detail);
  const filtered = fandomFilter ? ranked.filter(item => item.matching.includes(fandomFilter)) : ranked;
  const recommendedFandoms = useMemo(() => {
    if (!snapshot) return [];
    const ids = new Set(ranked.flatMap(r => r.matching));
    return snapshot.fandoms.filter(f => ids.has(f.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, ranked]);
  useEffect(() => {
    const onHash = () => { setPage(pageFromHash()); setDetail(undefined); setLimit(20); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (fandomFilter && !recommendedFandoms.some(f => f.id === fandomFilter)) setFandomFilter(undefined);
  }, [fandomFilter, recommendedFandoms]);
  useEffect(() => { if (next) { const image = new Image(); image.src = next; } }, [next]);
  const decide = async (kind: 'like' | 'pass') => {
    if (acting || !current) return;
    setActing(true);
    try { await controller.decide(kind); } finally { setActing(false); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (page !== 'discover' || detail || document.querySelector('dialog[open]') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement)?.closest('button,a,input,select,textarea,[tabindex]')) return;
      if (e.key.toLowerCase() === 'l') { e.preventDefault(); void decide('like'); }
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); void decide('pass'); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="#/discover" aria-label="Circle Crush"><span className="brand-mark"><Icon name="heart" size={23}/></span><span>circle<span className="brand-accent">crush</span><span className="brand-dot">✳</span></span></a>
      <nav className="main-nav" aria-label={language === 'id' ? 'Navigasi utama' : 'Main navigation'}>
        {(['discover', 'recommendations', 'saved'] as const).map(p => <a key={p} href={`#/${p}`} className={page === p ? 'active' : ''} aria-current={page === p ? 'page' : undefined}><Icon name={p === 'discover' ? 'compass' : p === 'recommendations' ? 'sparkle' : 'bookmark'} size={18}/><span>{t[p]}</span>{p === 'saved' && Object.keys(visitor.saved).length > 0 && <span className="nav-count">{Object.keys(visitor.saved).length}</span>}</a>)}
      </nav><div className="language-switch" aria-label="Language">{(['id', 'en'] as const).map(l => <button key={l} lang={l} aria-pressed={language === l} onClick={() => controller.setLanguage(l)}>{l.toUpperCase()}</button>)}</div>
    </header>
    <main id="main" className={page === 'discover' ? 'discover-main' : 'collection-main'}>
      {page === 'discover' && <>
        <section className="discovery-layout">
          <div className="discovery-center">
            {loading ? <div className="booth-card"><Empty icon="heart" title={t.loading} body={t.loadingBody}><span className="loading-dots" aria-label={t.loading}><i/><i/><i/></span></Empty></div>
              : error ? <div className="booth-card"><Empty icon="image" title={t.failure} body={t.failureBody}><button className="primary-button" onClick={() => void controller.refresh()}>{t.retry}</button><details className="error-details"><summary>{t.errorDetails}</summary><pre>{error}</pre></details></Empty></div>
              : snapshot && current ? <>
                <article className="booth-card" key={current.id}><Gallery booth={current} t={t}/><div className="booth-information"><div className="booth-title-row"><h2>{current.name}</h2>{current.catalogUrl && <a className="icon-button" href={current.catalogUrl} target="_blank" rel="noreferrer" aria-label={t.source}><Icon name="external" size={18}/></a>}</div><Location booth={current} t={t} language={language}/><Fandoms booth={current} snapshot={snapshot} t={t}/></div></article>
                <div className="decision-controls"><button className="pass-button" disabled={acting} onClick={() => void decide('pass')}><Icon name="close" size={23}/>{t.pass}<kbd>P</kbd></button><button className="like-button" disabled={acting} onClick={() => void decide('like')}><Icon name="heart" size={23}/>{t.like}<kbd>L</kbd></button></div>
              </> : snapshot && generating ? <div className="booth-card card-skeleton" aria-busy="true"><div/><span/><span/></div>
              : snapshot && <div className="booth-card"><Empty icon={snapshot.booths.length ? 'check' : 'image'} title={generationError ? t.feedFailure : snapshot.booths.length ? t.exhausted : t.noCatalog} body={generationError ? t.failureBody : snapshot.booths.length ? t.exhaustedBody : t.noCatalogBody}>
                {generationError ? <button className="primary-button" onClick={() => void controller.fill()}>{t.retry}</button> : snapshot.booths.length ? <><a className="primary-button" href="#/recommendations">{t.recommendations}<Icon name="arrow" size={18}/></a>{Object.values(visitor.decisions).some(d => d.kind === 'pass') && <button className="text-button" onClick={() => void controller.revisit()}>{t.revisit}</button>}</> : <button className="primary-button" onClick={() => void controller.refresh()}>{t.retry}</button>}
                {generationErrorDetail && <details className="error-details"><summary>{t.errorDetails}</summary><pre>{generationErrorDetail}</pre></details>}
              </Empty></div>}
          </div>
        </section>
      </>}
      {page !== 'discover' && <section className="collection-page"><div className="collection-heading"><h1>{t[page]}</h1><span className="collection-count">{page === 'saved' ? Object.keys(visitor.saved).length : ranked.length}</span></div>
        {!snapshot ? <Empty title={loading ? t.loading : t.failure} body={loading ? t.loadingBody : t.failureBody}>{!loading && <button className="primary-button" onClick={() => void controller.refresh()}>{t.retry}</button>}</Empty>
          : page === 'recommendations' ? <>
            {ranked.length > 0 && <div className="filter-row"><button className={!fandomFilter ? 'active' : ''} onClick={() => { setFandomFilter(undefined); setLimit(20); }}>{t.all}<span>{ranked.length}</span></button>{recommendedFandoms.map(f => <button key={f.id} className={fandomFilter === f.id ? 'active' : ''} onClick={() => { setFandomFilter(f.id); setLimit(20); }}>{f.name}</button>)}</div>}
            {!ranked.length ? <Empty title={t.emptyRec} body={t.emptyRecBody}><a href="#/discover" className="primary-button">{t.start}<Icon name="arrow" size={18}/></a></Empty> : <><div className="results-grid">{filtered.slice(0, limit).map(({ booth, matching }, index) => <ResultCard key={booth.id} booth={booth} t={t} language={language} snapshot={snapshot} matching={matching} rank={index + 1} saved={!!visitor.saved[booth.id]} open={() => setDetail(booth)} toggle={() => void controller.toggleSaved(booth)}/>)}</div>{filtered.length > limit && <button className="show-more" onClick={() => setLimit(limit + 20)}>{t.more}<Icon name="arrow" size={18}/></button>}</>}
          </> : !Object.keys(visitor.saved).length ? <Empty icon="bookmark" title={t.emptyTitle} body={t.emptyBody}><a href="#/discover" className="primary-button">{t.start}<Icon name="arrow" size={18}/></a></Empty>
          : <div className="results-grid">{Object.values(visitor.saved).map(booth => <ResultCard key={booth.id} booth={booth} t={t} language={language} snapshot={snapshot} saved open={() => setDetail(booth)} toggle={() => void controller.toggleSaved(booth)} unavailable={!snapshot.booths.some(b => b.id === booth.id)}/>)}</div>}
      </section>}
    </main>
    {activeDetail && snapshot && <Detail key={activeDetail.id} booth={activeDetail} snapshot={snapshot} t={t} language={language} saved={!!visitor.saved[activeDetail.id]} toggle={() => void controller.toggleSaved(activeDetail)} close={() => setDetail(undefined)}/>}
  </div>;
}

function ResultCard({ booth, t, language, snapshot, matching, saved, rank, open, toggle, unavailable }: { booth: Booth; t: Copy; language: Language; snapshot: Snapshot; matching?: number[]; saved: boolean; rank?: number; open: () => void; toggle: () => void; unavailable?: boolean }) {
  return <article className="result-card"><div className="result-preview"><RemoteImage src={booth.gallery[0]} alt={booth.name} t={t}/><button className="preview-open" onClick={open} aria-label={`${t.catalog}: ${booth.name}`}/>{rank && <span className="rank-badge">#{String(rank).padStart(2, '0')}</span>}</div><div className="result-body"><div className="result-title"><button onClick={open}>{booth.name}</button><button className={`save-button ${saved ? 'saved' : ''}`} aria-label={saved ? t.unsave : t.save} aria-pressed={saved} onClick={toggle}><Icon name={saved ? 'check' : 'bookmark'} size={19}/></button></div><Location booth={booth} t={t} language={language}/>{unavailable ? <p className="unavailable" title={t.unavailableBody}>{t.unavailable}</p> : <Fandoms booth={booth} snapshot={snapshot} t={t} matching={matching}/>}</div></article>;
}
