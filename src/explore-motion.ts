import { useEffect, useRef, useState } from 'react';
import type { Booth } from './types';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function useDecisionMotion(booth: Booth | undefined, commit: (kind: 'like' | 'pass') => Promise<void>) {
  const reduced = useReducedMotion();
  const [reaction, setReaction] = useState<{ kind: 'like' | 'pass'; booth: Booth }>();
  const locked = useRef(false);
  const mounted = useRef(true);
  const finish = useRef<() => void>(() => {});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      finish.current();
    };
  }, []);
  const decide = async (kind: 'like' | 'pass') => {
    if (locked.current || !booth) return;
    locked.current = true;
    setReaction({ kind, booth });
    const motion = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, reduced ? 0 : 360);
      finish.current = () => { clearTimeout(timer); resolve(); };
    });
    try {
      // Persist immediately; retain the outgoing card visually until its exit ends.
      await Promise.all([commit(kind), motion]);
    } finally {
      finish.current();
      locked.current = false;
      if (mounted.current) {
        setReaction(undefined);
      }
    }
  };
  return { displayed: reaction?.booth ?? booth, reaction: reaction?.kind, acting: !!reaction, decide };
}
