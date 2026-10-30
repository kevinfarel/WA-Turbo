import { z } from 'zod';

// What Claude returns for one chat. `cite` is the local message id printed as [#id] in the transcript.

const Cite = z.number().int();

export const ChatInsightOut = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  actions: z.array(z.object({ text: z.string(), owner: z.string(), due: z.string(), cite: Cite.nullable() })),
  decisions: z.array(z.string()),
  questions: z.array(z.string()),
  status: z.object({ stage: z.string(), risk: z.enum(['high', 'watch', 'low']), next: z.string() }),
  loops: z.array(z.object({
    dir: z.enum(['owed', 'waiting']),
    kind: z.enum(['question', 'confirmation', 'commitment']),
    topic: z.string(),
    asked_by: z.string(),
    cite: Cite,
    blocks: z.string().nullable(),
  })),
  loop_reviews: z.array(z.object({
    loop_id: z.number().int(),
    verdict: z.enum(['keep', 'likely_answered', 'not_a_loop']),
    reason: z.string().nullable(),
    topic: z.string().nullable(),
    blocks: z.string().nullable(),
  })),
});
export type ChatInsightOut = z.infer<typeof ChatInsightOut>;

export const SynthesisOut = z.object({ overview: z.string() });
export type SynthesisOut = z.infer<typeof SynthesisOut>;
