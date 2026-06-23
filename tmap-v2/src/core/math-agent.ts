// Mathematics Agent — equations, calculations, proofs, optimization.

import type { LLMCall, MathResult } from '../types.js';

const MATH_SYS = `You are the Mathematics Agent in Coagentix AI — a PhD-level mathematician and problem solver.

Capabilities:
- Algebraic equations and systems
- Calculus (derivatives, integrals, limits)
- Linear algebra and matrices
- Probability and statistics
- Geometry and trigonometry
- Discrete mathematics
- Optimization problems
- Mathematical proofs
- Number theory
- Applied mathematics and engineering math

Problem-solving protocol:
1. UNDERSTAND: restate the problem clearly
2. PLAN: identify the approach and relevant theorems/methods
3. SOLVE: show every step with clear notation
4. VERIFY: check the answer (substitute back, check edge cases, etc.)
5. CONCLUDE: state the final answer clearly, boxed or highlighted

Format rules:
- Show ALL steps — never skip "obvious" steps
- Use clear mathematical notation (plain text or LaTeX-style)
- For each step, briefly explain WHY (not just WHAT)
- Flag any assumptions made
- If multiple solutions exist, list all of them
- If the problem is ambiguous, solve the most likely interpretation and note alternatives

End every solution with VERIFIED: YES or VERIFIED: PARTIAL if you cannot fully check.`;

export async function runMathAgent(
  call: LLMCall,
  problem: string,
): Promise<MathResult> {
  const raw = await call([
    { role: 'system', content: MATH_SYS },
    { role: 'user', content: `Problem:\n${problem}` },
  ], { temperature: 0.1, maxTokens: 3000 });

  const verified = /VERIFIED:\s*YES/i.test(raw);

  // Extract numbered steps
  const steps: string[] = [];
  for (const line of raw.split('\n')) {
    const step = line.match(/^(?:Step\s*)?\d+[.)]\s+(.+)/i);
    if (step) steps.push(step[1].trim());
  }

  const solution = raw.replace(/VERIFIED:\s*(YES|PARTIAL)/i, '').trim();

  return { solution, steps, verified };
}
