// Help content (Round 8). Pure data, no imports: also turned into Docs/USER-GUIDE.md.
export interface HelpTopic {
  /** Stable id used by <HelpButton topic="..."> and tours. */
  id: string;
  title: string;
  /** Which part of the app (for grouping in Help topics and the user guide). */
  area: 'Start' | 'Arrange' | 'Write' | 'Mix' | 'Recordings' | 'Files' | 'Bonus';
  /** What it is, in one or two plain sentences. */
  what: string;
  /** Why / when you'd use it. */
  when: string;
  /** A 3-step example. */
  steps: string[];
  /** Extra tips (optional). */
  tips?: string[];
}

export interface GlossaryEntry {
  term: string;
  meaning: string;
}
