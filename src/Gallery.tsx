import { useEffect, useRef, useState } from 'react';
import type { Copy } from './copy';
import type { Booth } from './types';
import { Icon } from './icons';
import { useReducedMotion } from './explore-motion';

export function RemoteImage({ src, alt, t, ...props }: { src: string; alt: string; t: Copy; loading?: 'lazy' | 'eager'; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setFailed(false); setLoaded(false); setRetry(0); }, [src]);
  return <div className={`remote-image ${loaded ? 'is-loaded' : ''} ${props.className ?? ''}`}>
    {!failed && <img key={`${src}:${retry}`} src={src} alt={alt} loading={props.loading ?? 'lazy'} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    {!loaded && !failed && <span className="image-placeholder"><Icon name="image" size={28}/></span>}
    {failed && <div className="image-failure"><Icon name="image" size={28}/><span>{t.imageError}</span><button className="text-button" onClick={() => { setFailed(false); setLoaded(false); setRetry(retry + 1); }}>{t.imageRetry}</button></div>}
  </div>;
}

export function Gallery({ booth, t, fullscreen = false }: { booth: Booth; t: Copy; fullscreen?: boolean }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [enlarged, setEnlarged] = useState(false);
  const scroll = (next: number) => {
    const target = Math.max(0, Math.min(booth.gallery.length - 1, next));
    track.current?.scrollTo({ left: target * track.current.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' });
    setIndex(target); setEnlarged(false);
  };
  useEffect(() => {
    if (zoom) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [zoom]);
  return <div className={`gallery ${fullscreen ? 'gallery-detail' : ''}`}>
    <div className="gallery-track" ref={track} onScroll={event => {
      const el = event.currentTarget;
      if (el.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth));
    }} tabIndex={0} aria-label={`${t.catalog}: ${booth.name}`} onDoubleClick={() => { setEnlarged(false); setZoom(true); }} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); scroll(index + (event.key === 'ArrowRight' ? 1 : -1)); }
    }}>
      {booth.gallery.map((url, i) => <div className="gallery-slide" key={`${url}:${i}`}><RemoteImage src={url} alt={`${booth.name} · ${t.catalog} ${i + 1}`} t={t} loading={i === 0 ? 'eager' : 'lazy'}/></div>)}
    </div>
    <span className="catalog-label"><Icon name="image" size={14}/> {t.catalog}</span>
    <span className="image-counter"><span key={index} className="counter-tick">{index + 1}</span> / {booth.gallery.length}</span>
    {booth.gallery.length > 1 && <>
      <button className="gallery-arrow gallery-prev" aria-label={t.previous} disabled={index === 0} onClick={() => scroll(index - 1)}><Icon name="left"/></button>
      <button className="gallery-arrow gallery-next" aria-label={t.next} disabled={index >= booth.gallery.length - 1} onClick={() => scroll(index + 1)}><Icon name="right"/></button>
    </>}
    <button ref={opener} className="zoom-button" aria-label={t.zoom} onClick={() => { setEnlarged(false); setZoom(true); }}><Icon name="zoom" size={18}/></button>
    {booth.gallery.length > 1 && <div className="gallery-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(index + 1) / booth.gallery.length})` }}/></div>}
    <div className="gallery-dots" role="group" aria-label={t.catalogPages}>{booth.gallery.length > 1 && booth.gallery.length <= 12 && booth.gallery.map((_, i) => <button className={i === index ? 'active' : ''} key={i} aria-label={`${t.catalog} ${i + 1}`} aria-pressed={i === index} onClick={() => scroll(i)}/>)}</div>
    <dialog ref={dialog} className="zoom-dialog" aria-label={`${t.zoom}: ${booth.name}`} onClose={() => { setZoom(false); opener.current?.focus(); }} onCancel={() => setZoom(false)}>
      <div className="zoom-toolbar"><span>{booth.name} · {index + 1}/{booth.gallery.length}</span><button className="icon-button" aria-label={t.close} onClick={() => setZoom(false)}><Icon name="close"/></button></div>
      <div className={`zoom-canvas ${enlarged ? 'enlarged' : ''}`}>
        <button className="zoom-image-button" aria-label={t.zoom} onClick={() => setEnlarged(!enlarged)}><img src={booth.gallery[index]} alt={`${booth.name} ${t.catalog}`} /></button>
      </div>
      {booth.gallery.length > 1 && <div className="zoom-navigation"><button className="icon-button" disabled={index === 0} aria-label={t.previous} onClick={() => scroll(index - 1)}><Icon name="left"/></button><button className="icon-button" disabled={index === booth.gallery.length - 1} aria-label={t.next} onClick={() => scroll(index + 1)}><Icon name="right"/></button></div>}
    </dialog>
  </div>;
}
