// Round 8: the "?" help button every panel has, and the "More options" fold for expert settings.
import { useSyncExternalStore } from 'react';

type HelpListener = () => void;
/** Which help page is open (null = none); '' = the topic list. */
class HelpCtl {
  topic: string | null = null;
  private ls = new Set<HelpListener>();
  on(f: HelpListener) {
    this.ls.add(f);
    return () => this.ls.delete(f);
  }
  open(topic: string | null) {
    this.topic = topic;
    this.ls.forEach((f) => f());
  }
}
export const helpCtl = new HelpCtl();
export function useHelpTopic(): string | null {
  return useSyncExternalStore((f) => helpCtl.on(f), () => helpCtl.topic);
}

/** A small "?" that opens the help page for a panel. */
export function HelpButton({ topic, label }: { topic: string; label?: string }) {
  return (
    <button className="help-q" data-help={topic} title={`Help: what this ${label ?? 'panel'} is for, when to use it, and a short example`}
      onClick={(e) => { e.stopPropagation(); helpCtl.open(topic); }}>?</button>
  );
}

/** Expert settings, folded away by default. Children stay in the page (tests can still reach them). */
export function MoreOptions({ children, label = 'More options', title }: { children: React.ReactNode; label?: string; title?: string }) {
  return (
    <details className="more-opts">
      <summary title={title ?? 'Expert settings most people never need to change'}>{label}</summary>
      <div className="more-body">{children}</div>
    </details>
  );
}
