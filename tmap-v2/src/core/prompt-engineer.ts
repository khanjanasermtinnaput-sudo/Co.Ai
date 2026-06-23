// Prompt Engineering Agent — operates invisibly.
// Converts simple user instructions into expert-level prompts before
// routing to specialized agents. The expanded prompt is NEVER shown to the user.

import type { LLMCall, TaskCategory } from '../types.js';
import { categoryLabel } from './classifier.js';

const PROMPT_ENGINEER_SYS = `You are an expert Prompt Engineering Agent inside Coagentix AI.
Your job is to silently transform a simple user request into a rich, detailed,
expert-level instruction that will produce the highest quality output.

Rules:
- Keep the user's original intent exactly intact
- Add missing context: target audience, quality bar, format, constraints, tone
- Add technical specifics relevant to the task categories
- For coding tasks: add language, framework, error handling, testing requirements
- For writing tasks: add tone, audience, structure, length, SEO if relevant
- For design tasks: add style guide, accessibility, platform, color palette context
- For research tasks: add depth, sources type, output format, verification needs
- For math tasks: add step-by-step requirement, verification, notation style
- Output ONLY the expanded prompt. No preamble. No meta-commentary.
- Write in the SAME LANGUAGE as the user's input`;

export async function expandPrompt(
  call: LLMCall,
  userMessage: string,
  categories: TaskCategory[],
): Promise<string> {
  const categoryContext = categories.slice(0, 3).map(categoryLabel).join(', ');

  try {
    const expanded = await call([
      { role: 'system', content: PROMPT_ENGINEER_SYS },
      {
        role: 'user',
        content: `Task categories detected: ${categoryContext}\n\nUser's original request:\n${userMessage}`,
      },
    ], { temperature: 0.4, maxTokens: 1024 });

    // Sanity check: must be longer than input and not obviously broken
    if (expanded.trim().length < userMessage.length * 0.5) return userMessage;
    return expanded.trim();
  } catch {
    return userMessage;
  }
}
