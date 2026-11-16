// Undo/redo over immutable model snapshots. Every edit is a pure Song -> Song function,
// so a snapshot stack is simple and exact.

export interface HistoryEntry<T> {
  state: T;
  label: string;
}

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private _present: T;
  private _presentLabel = 'Open';

  constructor(initial: T, private readonly limit = 200) {
    this._present = initial;
  }

  get present(): T {
    return this._present;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.canUndo ? this._presentLabel : undefined;
  }
  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  private merge: { key: string; at: number } | null = null;

  /**
   * Record a new state. A state identical (===) to the present is ignored. Edits with the same
   * `mergeKey` within `mergeMs` of each other (e.g. one fader drag) become ONE undo step.
   */
  apply(next: T, label: string, mergeKey?: string, now = Date.now(), mergeMs = 1500): T {
    if (next === this._present) return next;
    if (mergeKey && this.merge && this.merge.key === mergeKey && now - this.merge.at < mergeMs && this.past.length) {
      this._present = next;
      this._presentLabel = label;
      this.future = [];
      this.merge.at = now;
      return next;
    }
    this.merge = mergeKey ? { key: mergeKey, at: now } : null;
    this.past.push({ state: this._present, label: this._presentLabel });
    if (this.past.length > this.limit) this.past.shift();
    this._present = next;
    this._presentLabel = label;
    this.future = [];
    return next;
  }

  undo(): T {
    this.merge = null;
    const prev = this.past.pop();
    if (!prev) return this._present;
    this.future.push({ state: this._present, label: this._presentLabel });
    this._present = prev.state;
    this._presentLabel = prev.label;
    return this._present;
  }

  redo(): T {
    this.merge = null;
    const next = this.future.pop();
    if (!next) return this._present;
    this.past.push({ state: this._present, label: this._presentLabel });
    this._present = next.state;
    this._presentLabel = next.label;
    return this._present;
  }

  /** Start over (e.g. after opening another file). */
  reset(state: T) {
    this.past = [];
    this.future = [];
    this._present = state;
    this._presentLabel = 'Open';
  }
}
