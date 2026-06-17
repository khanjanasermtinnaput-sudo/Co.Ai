// Chief Agent — AOF AI Universal Orchestration System.
//
// Execution flow:
// User Request → Intent Analysis → Task Planning → Task Decomposition →
// Agent Assignment → Execution → Quality Review → Final Response
//
// The Chief Agent never directly solves tasks (unless trivial).
// It delegates to specialized agents and merges their outputs.

import type {
  LLMCall, TaskCategory, AgentType, ChiefPlan, OrchestrationResult, ChatMessage,
} from '../types.js';
import type { CredentialBag } from '../config.js';
import type { HealthStore } from '../dars/health.js';
import type { AgentLogEntry } from '../dars/run.js';
import { classifyTask } from './classifier.js';
import { expandPrompt } from './prompt-engineer.js';
import { runResearchAgent } from './research-agent.js';
import { runWritingAgent } from './writing-agent.js';
import { runMathAgent } from './math-agent.js';
import { generateImagePrompt } from './vision-agent.js';
import { reviewLoop } from './review-gate.js';
import { routeToRole, selectTemperature } from './model-router.js';
import { chatWithDARS } from '../dars/run.js';

export type ChiefEmit = (agent: AgentType | 'system' | 'chief', text: string, kind?: 'status' | 'output' | 'error') => void;

export interface ChiefOpts {
  creds: CredentialBag;
  health: HealthStore;
  emit: ChiefEmit;
  sessionId: string;
  history?: ChatMessage[];
  enableQualityGate?: boolean; // default true
  planOnly?: boolean;
  onLog?: (entry: AgentLogEntry) => void;
}

const CHIEF_ANALYSIS_SYS = `You are the Chief Agent in AOF AI — an intelligent meta-orchestrator.
Your job is to analyze user requests and create precise execution plans.

For every request output a JSON plan:
{
  "intent": "one-line summary of what user actually wants",
  "strategy": "brief description of how to solve this best",
  "subtasks": ["specific subtask 1", "specific subtask 2"],
  "needsMultipleAgents": true | false,
  "primaryApproach": "direct_answer | research_then_synthesize | code_and_explain | write_and_review | calculate_and_verify | multi_agent_collaborate"
}

Guidelines:
- For simple factual questions: direct_answer
- For complex topics needing deep information: research_then_synthesize
- For coding/technical tasks: code_and_explain
- For content creation: write_and_review
- For math/science: calculate_and_verify
- For multi-domain projects: multi_agent_collaborate
Output ONLY the JSON. No preamble.`;

const SYNTHESIS_SYS = `You are the Chief Agent in AOF AI. You are synthesizing outputs from multiple specialized agents.
Create a unified, coherent final response that:
1. Integrates all agent outputs seamlessly
2. Removes redundancy
3. Maintains consistent tone and structure
4. Presents a complete, polished answer
5. Is written as if a single expert wrote it (no "Agent 1 said...", "According to the Research Agent...")
Write in the SAME LANGUAGE as the user's original request.`;

export async function runChiefAgent(
  userMessage: string,
  opts: ChiefOpts,
): Promise<OrchestrationResult> {
  const { creds, health, emit, sessionId, history = [], enableQualityGate = true, onLog } = opts;

  // Phase 1: Classify intent
  emit('chief', 'analyzing request...', 'status');
  const classification = classifyTask(userMessage);
  const { categories, primary } = classification;

  emit('chief', `detected: ${categories.slice(0, 3).join(', ')}`, 'status');

  // Phase 2: Route to best model for this task
  const routing = routeToRole(categories, creds, health);
  const temperature = selectTemperature(routing.qualityPriority, primary);

  const makeCall = (role = routing.role): LLMCall => async (messages, callOpts = {}) => {
    const r = await chatWithDARS(role, messages, callOpts, {
      creds, health, emit: (r, t, k) => emit('system' as AgentType, `[${r}] ${t}`, k), sessionId,
      onLog,
    });
    return r.text;
  };

  // Phase 3: Expand prompt (hidden from user)
  emit('chief', 'preparing expert prompt...', 'status');
  const expandedPrompt = await expandPrompt(makeCall(), userMessage, categories);

  // Phase 4: Analyze and plan
  let plan: ChiefPlan | null = null;
  try {
    const planRaw = await makeCall()([
      { role: 'system', content: CHIEF_ANALYSIS_SYS },
      { role: 'user', content: expandedPrompt },
    ], { temperature: 0.2 });

    const jsonMatch = planRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<ChiefPlan & { primaryApproach: string; needsMultipleAgents: boolean }>;
      plan = {
        intent: parsed.intent ?? userMessage.slice(0, 100),
        categories,
        agents: selectAgents(categories),
        subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks : [userMessage],
        strategy: parsed.strategy ?? 'direct execution',
        expandedPrompt,
      };
      emit('chief', `strategy: ${parsed.primaryApproach ?? 'direct'} · ${plan.subtasks.length} subtask(s)`, 'status');
    }
  } catch { /* planning failure is non-fatal */ }

  if (!plan) {
    plan = {
      intent: userMessage.slice(0, 100),
      categories,
      agents: selectAgents(categories),
      subtasks: [userMessage],
      strategy: 'direct execution',
      expandedPrompt,
    };
  }

  if (opts.planOnly) {
    return {
      response: JSON.stringify(plan, null, 2),
      categories,
      agentsUsed: ['chief'],
      qualityScore: 100,
      iterations: 1,
    };
  }

  // Phase 5: Execute with specialized agents
  const agentsUsed: AgentType[] = ['chief'];
  const agentOutputs: string[] = [];

  for (const agent of plan.agents) {
    const task = plan.subtasks[0] ?? expandedPrompt;

    try {
      if (agent === 'research' && (categories.includes('research') || categories.includes('science') || categories.includes('education') || categories.includes('business'))) {
        emit('research', 'gathering information...', 'status');
        const result = await runResearchAgent(makeCall('planner'), task, history.map((m) => m.content).join('\n'));
        agentOutputs.push(result.answer);
        agentsUsed.push('research');
        emit('research', `confidence: ${result.confidence}`, 'output');

      } else if (agent === 'writing' && (categories.includes('writing') || categories.includes('business') || categories.includes('education'))) {
        emit('writing', 'creating content...', 'status');
        const context = agentOutputs.join('\n\n');
        const result = await runWritingAgent(makeCall('planner'), task, context || undefined);
        agentOutputs.push(result.content);
        agentsUsed.push('writing');
        emit('writing', `${result.wordCount} words · ${result.tone} tone`, 'output');

      } else if (agent === 'math' && (categories.includes('mathematics') || categories.includes('science'))) {
        emit('math', 'solving...', 'status');
        const result = await runMathAgent(makeCall('reviewer'), task);
        agentOutputs.push(result.solution);
        agentsUsed.push('math');
        emit('math', `verified: ${result.verified ? 'yes' : 'partial'}`, 'output');

      } else if (agent === 'vision' && (categories.includes('image_generation') || categories.includes('image_editing'))) {
        emit('vision', 'processing image request...', 'status');
        const spec = await generateImagePrompt(makeCall('planner'), task);
        agentOutputs.push(
          `**Image Prompt Generated:**\n\n**Style:** ${spec.style}\n**Lighting:** ${spec.lighting}\n**Composition:** ${spec.composition}\n\n**Ready-to-use prompt:**\n\`\`\`\n${spec.fullPrompt}\n\`\`\`\n\n**Negative prompt:** ${spec.negativePrompt}`,
        );
        agentsUsed.push('vision');

      } else if (agent === 'coding') {
        // Coding tasks route through TMAP — handled by /v1/run endpoint.
        // Chief Agent handles non-coding tasks and defers to TMAP for code.
        emit('coding', 'routing to code engine...', 'status');
        const directAnswer = await makeCall('coder')([
          {
            role: 'system',
            content: 'You are an expert software engineer. Answer the coding question thoroughly with code examples.',
          },
          {
            role: 'user',
            content: expandedPrompt,
          },
          ...history.slice(-4),
        ], { temperature: 0.15, maxTokens: 4096 });
        agentOutputs.push(directAnswer);
        agentsUsed.push('coding');
      }
    } catch (e) {
      emit('system' as AgentType, `${agent} agent error: ${(e as Error).message}`, 'error');
    }
  }

  // If no specialized agent ran (general question), use direct answer
  if (agentOutputs.length === 0) {
    emit('chief', 'generating direct answer...', 'status');
    const directAnswer = await makeCall()([
      {
        role: 'system',
        content: 'You are AOF AI, a highly capable universal AI assistant. Answer thoroughly, accurately, and helpfully. Use markdown formatting.',
      },
      ...history.slice(-6),
      { role: 'user', content: expandedPrompt },
    ], { temperature, maxTokens: 4096 });
    agentOutputs.push(directAnswer);
  }

  // Phase 6: Merge outputs if multiple agents ran
  let finalResponse: string;
  if (agentOutputs.length === 1) {
    finalResponse = agentOutputs[0];
  } else {
    emit('chief', 'synthesizing results from all agents...', 'status');
    finalResponse = await makeCall()([
      { role: 'system', content: SYNTHESIS_SYS },
      {
        role: 'user',
        content: `Original request: ${userMessage}\n\nAgent outputs to synthesize:\n\n${agentOutputs.map((o, i) => `--- Output ${i + 1} ---\n${o}`).join('\n\n')}`,
      },
    ], { temperature: 0.3, maxTokens: 4096 });
  }

  // Phase 7: Quality review gate
  let qualityScore = 85; // default if gate disabled
  let iterations = 1;

  if (enableQualityGate) {
    emit('chief', 'quality review...', 'status');

    const loopResult = await reviewLoop(
      makeCall('reviewer'),
      async (critique) => {
        if (!critique) return finalResponse;
        // Revision pass
        return makeCall()([
          {
            role: 'system',
            content: 'You are AOF AI. Revise and improve the following response based on the quality feedback. Write in the same language as the original response.',
          },
          {
            role: 'user',
            content: `Original request: ${userMessage}\n\nCurrent response:\n${finalResponse}\n\nQuality feedback:\n${critique}`,
          },
        ], { temperature: 0.3, maxTokens: 4096 });
      },
      userMessage,
      categories,
      (iter, score) => {
        emit('chief', `quality score: ${score}/100 (pass ≥ 90) — iteration ${iter}`, 'status');
      },
    );

    finalResponse = loopResult.response;
    qualityScore = loopResult.qualityScore;
    iterations = loopResult.iterations;

    if (loopResult.passed) {
      emit('chief', `quality approved: ${qualityScore}/100`, 'status');
    } else {
      emit('chief', `quality: ${qualityScore}/100 (best achieved)`, 'status');
    }
  }

  return {
    response: finalResponse,
    categories,
    agentsUsed,
    qualityScore,
    iterations,
  };
}

function selectAgents(categories: TaskCategory[]): AgentType[] {
  const agents = new Set<AgentType>();

  for (const cat of categories) {
    if (cat === 'coding' || cat === 'ui_design' || cat === 'data_analysis') agents.add('coding');
    if (cat === 'research' || cat === 'science' || cat === 'education') agents.add('research');
    if (cat === 'writing' || cat === 'business' || cat === 'product_design' || cat === 'ux_design') agents.add('writing');
    if (cat === 'mathematics') agents.add('math');
    if (cat === 'image_generation' || cat === 'image_editing') agents.add('vision');
  }

  // If no specific agent selected, do direct answer (no specialized agent needed)
  return Array.from(agents);
}
