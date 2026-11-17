// Round 7 "Describe a song" with Claude: only when ANTHROPIC_API_KEY is set in the environment.
// The key is read by the SDK from the environment and is never written to settings, logs, the
// project or the renderer. The answer is a song plan (structured output), checked by sanitizePlan.
import Anthropic from '@anthropic-ai/sdk';
import { INSTRUMENTS, SONG_PLAN_SCHEMA, type SongPlan } from '../model';

export const claudeAvailable = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = [
  'You turn a short description of a song into a plan for a virtual band app.',
  'The plan is played by four band roles: drums, bass, rhythm (chords) and lead (melody/fills). Leave a role out to make it silent.',
  'Styles available: rock, blues (shuffle), country, jazz (swing), pop. Pick the closest one.',
  'Write chords as Roman numerals relative to the key, one entry per bar ("IV V" = two chords in one bar), e.g. I7, ii7, V7, bVII, iv, Imaj7, iiø7, V/V. Minor keys use lowercase i, iv, bVI, bVII, V7.',
  'Sections have a name (Intro, Verse, Chorus, Bridge, Solo, Outro, A, B...) and a repeat count. Keep the whole song under 200 bars.',
  'instrumentId must be one of: ' + INSTRUMENTS.map((i) => i.id).join(', ') + '.',
  'timeSig is [beats, beat unit], e.g. [4,4], [3,4], [6,8]. bpm is quarter notes per minute.',
  'In notes, list in a few words anything you assumed or could not do.',
].join('\n');

export async function describeWithClaude(description: string): Promise<{ plan: Partial<SongPlan>; model: string }> {
  if (!claudeAvailable()) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ timeout: 120_000, maxRetries: 2 });
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SONG_PLAN_SCHEMA as unknown as Record<string, unknown> } },
    system: SYSTEM,
    messages: [{ role: 'user', content: description.slice(0, 4000) }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this description; the built-in parser was used instead.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let plan: Partial<SongPlan>;
  try {
    plan = JSON.parse(text) as Partial<SongPlan>;
  } catch {
    throw new Error('Claude did not return a song plan.');
  }
  return { plan, model: res.model };
}
