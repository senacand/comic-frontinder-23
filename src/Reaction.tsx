import { Icon } from './icons';

export function Reaction({ kind }: { kind: 'like' | 'pass' }) {
  return <div className={`reaction-overlay reaction-${kind}`} aria-hidden="true">
    <div className="reaction-symbol"><Icon name={kind === 'like' ? 'heart' : 'close'} size={96}/></div>
  </div>;
}
