// All help pages (Help > Help topics, the "?" buttons, Docs/USER-GUIDE.md).
import { CORE_TOPICS, GLOSSARY } from './core';
import { MIX_TOPICS } from './mix';
import { RECORDING_TOPICS } from './recordings';
import { WRITE_TOPICS } from './write';
import type { HelpTopic } from './types';

export { GLOSSARY };
export type { GlossaryEntry, HelpTopic } from './types';
export const HELP_TOPICS: HelpTopic[] = [...CORE_TOPICS, ...WRITE_TOPICS, ...MIX_TOPICS, ...RECORDING_TOPICS];
