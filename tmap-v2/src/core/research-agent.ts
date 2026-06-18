// Research Agent — information gathering, fact-checking, deep analysis.
// Preferred models: best available (quality-first routing).

import type { LLMCall, ResearchResult } from '../types.js';

const RESEARCH_SYS = `You are the Research Agent in Nexora — a world-class research analyst.

Your job:
1. Thoroughly answer the user's question with accurate, well-structured information
2. Cite the type of sources you draw from (academic, industry, official documentation, etc.)
3. Flag any areas of uncertainty or where information may be outdated
4. Provide concrete examples and evidence
5. Structure your response clearly: Summary → Key Findings → Details → Recommendations

Quality standards:
- Accuracy over completeness — never invent facts
- Acknowledge uncertainty explicitly
- Give confidence level: HIGH (well-established) / MEDIUM (likely but verify) / LOW (uncertain)
- Be comprehensive but concise
- Use bullet points, headers, and tables where they improve clarity

Always end with: CONFIDENCE: HIGH | MEDIUM | LOW`;

export async function runResearchAgent(
  call: LLMCall,
  query: string,
  context?: string,
): Promise<ResearchResult> {
  const userContent = context
    ? `Context:\n${context}\n\nResearch query:\n${query}`
    : `Research query:\n${query}`;

  const raw = await call([
    { role: 'system', content: RESEARCH_SYS },
    { role: 'user', content: userContent },
  ], { temperature: 0.3, maxTokens: 3000 });

  const confidenceMatch = raw.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
  const confidence = (confidenceMatch?.[1]?.toUpperCase() ?? 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW';

  const sourceTypes: string[] = [];
  const sourceMatches = raw.match(/\b(academic|research|official|documentation|industry|scientific|peer.reviewed|study|report)\b/gi);
  if (sourceMatches) {
    sourceTypes.push(...[...new Set(sourceMatches.map((s) => s.toLowerCase()))]);
  }

  const answer = raw.replace(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i, '').trim();

  return {
    answer,
    sources: sourceTypes.slice(0, 5),
    confidence: confidence.toLowerCase() as 'high' | 'medium' | 'low',
  };
}
