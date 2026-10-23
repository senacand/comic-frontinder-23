import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Copy } from './copy';
import type { Booth } from './types';
import { Icon } from './icons';
import { useReducedMotion } from './explore-motion';
import { useImageZoom } from './image-zoom';

type RemoteImageProps = { src: string; alt: string; t: Copy; loading?: 'lazy' | 'eager'; className?: string };

export function RemoteImage(props: RemoteImageProps) {
  return <ImageRequest key={props.src} {...props}/>;
}

function ImageRequest({ src, alt, t, ...props }: RemoteImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  // Preloaded images can finish before mount. Never reset their load state in a
  // passive effect: it can run after onLoad and leave the placeholder visible.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);
  return <div className={`remote-image ${loaded ? 'is-loaded' : ''} ${props.className ?? ''}`}>
    {!failed && <img ref={imageRef} key={`${src}:${retry}`} src={src} alt={alt} draggable={false} loading={props.loading ?? 'lazy'} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    {!loaded && !failed && <span className="image-placeholder"><Icon name="image" size={28}/></span>}
    {failed && <div className="image-failure"><Icon name="image" size={28}/><span>{t.imageError}</span><button className="text-button" onClick={() => { setFailed(false); setLoaded(false); setRetry(retry + 1); }}>{t.imageRetry}</button></div>}
  </div>;
}

function CatalogImage({ url, alt, t, eager, preview = false, active = true, open }: { url: string; alt: string; t: Copy; eager: boolean; preview?: boolean; active?: boolean; open?: () => void }) {
  const { surface, view, style, reset, toggle, suppressClick } = useImageZoom();
  useEffect(() => { if (!active) reset(); }, [active, reset]);
  return <div ref={surface} className={`pinch-surface ${view.scale > 1 ? 'is-zoomed' : ''}`} onClick={event => {
    if (!(event.target as HTMLElement).closest('button') && !suppressClick()) open?.();
  }} onDoubleClick={event => { if (!preview) { event.preventDefault(); toggle(); } }}>
    <div className="pinch-content" style={style}><RemoteImage src={url} alt={alt} t={t} loading={eager ? 'eager' : 'lazy'}/></div>
    {active && (!preview || view.scale > 1) && <button className="icon-button image-zoom-control" aria-label={view.scale > 1 ? t.resetZoom : t.zoom} onClick={toggle}><Icon name={view.scale > 1 ? 'close' : 'zoom'} size={18}/></button>}
  </div>;
}

function useTrackWidth(track: RefObject<HTMLDivElement | null>, selected: RefObject<number>) {
  const width = useRef(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    width.current = el.clientWidth;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!el.clientWidth || el.clientWidth === width.current) return;
      width.current = el.clientWidth;
      el.scrollTo({ left: selected.current * width.current, behavior: 'auto' });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [track, selected]);
  return width;
}

function ZoomViewer({ booth, t, initialIndex, close }: { booth: Booth; t: Copy; initialIndex: number; close: (index: number) => void }) {
  const reducedMotion = useReducedMotion();
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const selected = useRef(initialIndex);
  const width = useTrackWidth(track, selected);
  const scroll = (next: number) => {
    const target = Math.max(0, Math.min(booth.gallery.length - 1, next));
    selected.current = target; setIndex(target);
    track.current?.scrollTo({ left: target * track.current.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  useEffect(() => {
    dialog.current?.showModal();
    width.current = track.current?.clientWidth ?? 0;
    track.current?.scrollTo({ left: initialIndex * track.current.clientWidth, behavior: 'auto' });
  }, [initialIndex, width]);
  return <dialog ref={dialog} className="zoom-dialog" aria-label={`${t.zoom}: ${booth.name}`} onClose={() => close(selected.current)} onCancel={event => { event.preventDefault(); dialog.current?.close(); }} onKeyDown={event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); scroll(selected.current + (event.key === 'ArrowRight' ? 1 : -1)); }
  }}>
    <div className="zoom-toolbar"><span>{booth.name} · {index + 1}/{booth.gallery.length}</span><button className="icon-button" aria-label={t.close} onClick={() => dialog.current?.close()}><Icon name="close"/></button></div>
    <div ref={track} className="gallery-track zoom-track" tabIndex={0} aria-label={`${t.catalogPages}: ${booth.name}`} onScroll={event => {
      const el = event.currentTarget;
      if (!el.clientWidth) return;
      if (width.current && width.current !== el.clientWidth) {
        width.current = el.clientWidth;
        el.scrollTo({ left: selected.current * width.current, behavior: 'auto' }); return;
      }
      width.current = el.clientWidth;
      const next = Math.max(0, Math.min(booth.gallery.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
      selected.current = next; setIndex(next);
    }}>
      {booth.gallery.map((url, i) => <div className="gallery-slide" key={`${url}:${i}`}><CatalogImage url={url} alt={`${booth.name} · ${t.catalog} ${i + 1}`} t={t} eager={Math.abs(i - index) <= 1} active={i === index}/></div>)}
    </div>
    <div className="zoom-navigation"><button className="icon-button" disabled={index === 0} aria-label={t.previous} onClick={() => scroll(selected.current - 1)}><Icon name="left"/></button><span>{index + 1} / {booth.gallery.length}</span><button className="icon-button" disabled={index >= booth.gallery.length - 1} aria-label={t.next} onClick={() => scroll(selected.current + 1)}><Icon name="right"/></button></div>
  </dialog>;
}

export function Gallery({ booth, t, fullscreen = false }: { booth: Booth; t: Copy; fullscreen?: boolean }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const selected = useRef(0);
  const width = useTrackWidth(track, selected);
  const opener = useRef<HTMLButtonElement>(null);
  const scroll = (next: number, immediate = false) => {
    const target = Math.max(0, Math.min(booth.gallery.length - 1, next));
    selected.current = target;
    width.current = track.current?.clientWidth ?? 0;
    track.current?.scrollTo({ left: target * track.current.clientWidth, behavior: immediate || reducedMotion ? 'auto' : 'smooth' });
    setIndex(target);
  };
  return <div className={`gallery ${fullscreen ? 'gallery-detail' : ''}`}>
    <div className="gallery-track" ref={track} onScroll={event => {
      const el = event.currentTarget;
      if (!el.clientWidth) return;
      if (width.current && width.current !== el.clientWidth) {
        width.current = el.clientWidth;
        el.scrollTo({ left: selected.current * width.current, behavior: 'auto' }); return;
      }
      width.current = el.clientWidth;
      selected.current = Math.max(0, Math.min(booth.gallery.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
      setIndex(selected.current);
    }} tabIndex={0} aria-label={`${t.catalog}: ${booth.name}`} onDoubleClick={() => setZoom(true)} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); scroll(index + (event.key === 'ArrowRight' ? 1 : -1)); }
      if (event.key === 'Enter') { event.preventDefault(); setZoom(true); }
    }}>
      {booth.gallery.map((url, i) => <div className="gallery-slide" key={`${url}:${i}`}><CatalogImage url={url} alt={`${booth.name} · ${t.catalog} ${i + 1}`} t={t} eager={i === 0} preview active={i === index} open={() => setZoom(true)}/></div>)}
    </div>
    <span className="catalog-label"><Icon name="image" size={14}/> {t.catalog}</span>
    <span className="image-counter"><span key={index} className="counter-tick">{index + 1}</span> / {booth.gallery.length}</span>
    {booth.gallery.length > 1 && <>
      <button className="gallery-arrow gallery-prev" aria-label={t.previous} disabled={index === 0} onClick={() => scroll(index - 1)}><Icon name="left"/></button>
      <button className="gallery-arrow gallery-next" aria-label={t.next} disabled={index >= booth.gallery.length - 1} onClick={() => scroll(index + 1)}><Icon name="right"/></button>
    </>}
    <button ref={opener} className="zoom-button" aria-label={t.zoom} onClick={() => setZoom(true)}><Icon name="zoom" size={18}/></button>
    {booth.gallery.length > 1 && <div className="gallery-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(index + 1) / booth.gallery.length})` }}/></div>}
    <div className="gallery-dots" role="group" aria-label={t.catalogPages}>{booth.gallery.length > 1 && booth.gallery.length <= 12 && booth.gallery.map((_, i) => <button className={i === index ? 'active' : ''} key={i} aria-label={`${t.catalog} ${i + 1}`} aria-pressed={i === index} onClick={() => scroll(i)}/>)}</div>
    {zoom && <ZoomViewer booth={booth} t={t} initialIndex={index} close={next => { setZoom(false); scroll(next, true); opener.current?.focus(); }}/>}
  </div>;
}
