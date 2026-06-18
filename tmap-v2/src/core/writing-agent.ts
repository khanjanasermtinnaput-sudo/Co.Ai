// Writing Agent — blogs, documentation, marketing, reports, emails, stories.

import type { LLMCall, WritingResult } from '../types.js';

const WRITING_SYS = `You are the Writing Agent in Nexora — a professional writer and editor.

Capabilities:
- Blog posts, articles, essays
- Technical documentation
- Marketing copy and sales content
- Business reports and proposals
- Emails and professional communications
- Creative writing and storytelling
- SEO-optimized content

Writing standards:
- Strong opening hook that captures attention immediately
- Clear structure: introduction, body (with subheadings), conclusion
- Active voice, varied sentence length, engaging tone
- No filler phrases ("In today's world...", "It is important to note...")
- Concrete examples, data points, and specifics over vague generalities
- Appropriate tone for the context (professional / casual / persuasive / educational)
- Scannable with bullet points, numbered lists, and headers where helpful
- Strong, memorable closing with a clear call to action or takeaway

Adapt your style to match the user's requested format and audience.`;

const TONE_DETECTOR = [
  { pattern: /\bformal\b|\bprofessional\b|\bbusiness\b/i, tone: 'professional' },
  { pattern: /\bcasual\b|\bfriendly\b|\bconversational\b/i, tone: 'casual' },
  { pattern: /\bpersuasive\b|\bsales\b|\bmarketing\b|\bconvert\b/i, tone: 'persuasive' },
  { pattern: /\btechnical\b|\bdocumentation\b|\bdeveloper\b/i, tone: 'technical' },
  { pattern: /\bcreative\b|\bstory\b|\bnarrative\b|\bfiction\b/i, tone: 'creative' },
  { pattern: /\beducational\b|\bteach\b|\bexplain\b|\btutorial\b/i, tone: 'educational' },
];

function detectTone(task: string): string {
  for (const rule of TONE_DETECTOR) {
    if (rule.pattern.test(task)) return rule.tone;
  }
  return 'informative';
}

export async function runWritingAgent(
  call: LLMCall,
  task: string,
  context?: string,
): Promise<WritingResult> {
  const tone = detectTone(task);
  const userContent = context
    ? `Context / requirements:\n${context}\n\nWriting task:\n${task}`
    : `Writing task:\n${task}`;

  const content = await call([
    { role: 'system', content: WRITING_SYS },
    { role: 'user', content: userContent },
  ], { temperature: 0.7, maxTokens: 4096 });

  const wordCount = content.trim().split(/\s+/).length;

  return { content: content.trim(), wordCount, tone };
}
