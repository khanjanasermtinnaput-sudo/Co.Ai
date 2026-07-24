// registry.ts — the single source of truth mapping the validation spec's
// component list onto real modules in aof-web/tmap-v2. A component with no
// real implementation is listed with empty sourceFiles/testFiles rather than
// silently dropped — the scorer forces it to 0 and the report says why,
// following this repo's own anti-fabrication discipline (see aof-web/CLAUDE.md:
// "no fake/placeholder workflows... every runtime decision must be loggable").

export type Project = "aof-web" | "tmap-v2";

export type Category = "normal" | "boundary" | "edge" | "invalid" | "failure" | "recovery" | "security";

export interface ComponentTarget {
  project: Project;
  /** Test files, relative to the project root, run to exercise this component. */
  testFiles: string[];
  /** Source files, relative to the project root, whose coverage represents this component. */
  sourceFiles: string[];
}

export interface ComponentEntry {
  name: string;
  /** True for a component that is scored as an alias of the overall scorecard rather than tested standalone. */
  meta?: boolean;
  /** True for a component with no real implementation found in the codebase — scored 0, reported honestly. */
  notImplemented?: boolean;
  note?: string;
  targets: ComponentTarget[];
  requiredCategories: Category[];
}

export const COMPONENTS: ComponentEntry[] = [
  {
    name: "Architecture",
    meta: true,
    note: "Not independently testable — represented by the coverage-weighted overall scorecard.",
    targets: [],
    requiredCategories: [],
  },
  {
    name: "Runtime Kernel",
    targets: [
      { project: "tmap-v2", testFiles: ["src/tests/kernel.test.ts"], sourceFiles: ["src/v2/kernel/kernel.ts"] },
    ],
    requiredCategories: ["normal", "boundary", "failure", "recovery"],
  },
  {
    name: "Task Classifier",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/task-classifier.test.ts"],
        sourceFiles: ["src/lib/server/task-classifier.ts"],
      },
      { project: "tmap-v2", testFiles: [], sourceFiles: ["src/core/classifier.ts"] },
    ],
    requiredCategories: ["normal", "boundary", "edge", "invalid"],
  },
  {
    name: "Context Engine",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/workflow-context.test.ts"],
        sourceFiles: ["src/lib/server/workflow-context.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/context-engine.test.ts", "src/tests/context.test.ts"],
        sourceFiles: ["src/core/context-engine.ts", "src/core/context.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "edge"],
  },
  {
    name: "Memory System",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/memory-context.test.ts", "src/tests/system-memory.test.ts"],
        sourceFiles: ["src/lib/server/memory-context.ts", "src/lib/server/system-memory.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/memory.test.ts", "src/tests/image-memory.test.ts"],
        sourceFiles: ["src/core/memory.ts", "src/v2/memory-v2.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "invalid", "recovery"],
  },
  {
    name: "Prompt Compiler",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/prompt-compiler.test.ts"],
        sourceFiles: ["src/lib/server/prompt-compiler.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "edge"],
  },
  {
    name: "Token Manager",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/token-manager.test.ts"],
        sourceFiles: ["src/lib/server/token-manager.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "edge", "invalid"],
  },
  {
    name: "Cost Manager",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/cost-control-v2.test.ts", "src/tests/cost-resource-manager.test.ts"],
        sourceFiles: ["src/core/cost-budget.ts", "src/core/cost-resource-manager.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "failure"],
  },
  {
    name: "Execution Budget Manager",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/budget-enforcer.test.ts", "src/tests/turn-budget.test.ts"],
        sourceFiles: ["src/lib/server/budget-enforcer.ts", "src/lib/server/turn-budget.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/budget-enforcer.test.ts"],
        sourceFiles: ["src/core/budget-enforcer.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "failure"],
  },
  {
    name: "Workflow Orchestrator",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/orchestrator.test.ts", "src/tests/prestream-dispatch.test.ts"],
        sourceFiles: ["src/lib/server/orchestrator.ts", "src/lib/server/prestream-dispatch.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/orchestrator.test.ts", "src/tests/v2-orchestrator.test.ts"],
        sourceFiles: ["src/core/orchestrator.ts", "src/v2/orchestrator-v2.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "failure", "recovery"],
  },
  {
    name: "Provider Router",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/provider-router.test.ts", "src/tests/provider-registry.test.ts"],
        sourceFiles: ["src/lib/server/provider-router.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/dars-select.test.ts", "src/tests/dars-failover-bridge.test.ts"],
        sourceFiles: ["src/core/model-router.ts"],
      },
    ],
    requiredCategories: ["normal", "failure", "recovery"],
  },
  {
    name: "Provider Load Balancer",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/instance-pool.test.ts"],
        sourceFiles: ["src/providers/instance-pool.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "failure"],
  },
  {
    name: "Tool Engine",
    targets: [
      {
        project: "tmap-v2",
        testFiles: [
          "src/tests/tool-execution-engine.test.ts",
          "src/tests/v2-tool-agent.test.ts",
          "src/tests/v2-tool-node-executor.test.ts",
        ],
        sourceFiles: ["src/v2/tools/registry.ts"],
      },
    ],
    requiredCategories: ["normal", "invalid", "security"],
  },
  {
    name: "Security Manager",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/security-manager.test.ts", "src/tests/access.test.ts"],
        sourceFiles: ["src/lib/server/security-manager.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/admin-auth.test.ts", "src/tests/jwt-revocation.test.ts"],
        sourceFiles: ["src/server/audit.ts"],
      },
    ],
    requiredCategories: ["normal", "invalid", "security"],
  },
  {
    name: "Recovery Engine",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/recovery-engine.test.ts"],
        sourceFiles: ["src/v2/recovery/recovery-engine.ts"],
      },
    ],
    requiredCategories: ["normal", "failure", "recovery"],
  },
  {
    name: "Observability",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/telemetry.test.ts"],
        sourceFiles: ["src/lib/server/telemetry.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/phase7-logging.test.ts"],
        sourceFiles: ["src/v2/logger.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary"],
  },
  {
    name: "Logger",
    targets: [
      { project: "tmap-v2", testFiles: ["src/tests/logger.test.ts"], sourceFiles: ["src/server/logger.ts"] },
    ],
    requiredCategories: ["normal", "security"],
  },
  {
    name: "Configuration Manager",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/preflight.test.ts", "src/tests/config.test.ts"],
        sourceFiles: ["src/config.ts"],
      },
    ],
    requiredCategories: ["normal", "invalid"],
  },
  {
    name: "Plugin Manager",
    notImplemented: true,
    note: "No plugin/extension system found anywhere in aof-web or tmap-v2 — scored 0, not fabricated.",
    targets: [],
    requiredCategories: [],
  },
  {
    name: "RAA",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/requirement-analysis.test.ts", "src/tests/raa.test.ts", "src/tests/mock-requirements.test.ts"],
        sourceFiles: ["src/lib/server/requirement-analysis.ts", "src/lib/raa.ts"],
      },
      {
        project: "tmap-v2",
        testFiles: ["src/tests/raa.test.ts", "src/tests/raa-default-routing.test.ts"],
        sourceFiles: ["src/core/raa.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "invalid"],
  },
  {
    name: "TMAP / Planner",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/execution-plan.test.ts"],
        sourceFiles: ["src/lib/server/execution-plan.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "edge", "invalid"],
  },
  {
    name: "Architect / Coder / Reviewer agents",
    note: "TMAP agent personas are entries in one registry, not separate systems.",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/agent-registry.test.ts"],
        sourceFiles: ["src/lib/server/agent-registry.ts"],
      },
    ],
    requiredCategories: ["normal", "invalid"],
  },
  {
    name: "Validator",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/validator.test.ts", "src/tests/vote.test.ts"],
        sourceFiles: ["src/core/validator.ts", "src/core/vote.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "invalid"],
  },
  {
    name: "Reflection",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/self-reflection.test.ts"],
        sourceFiles: ["src/core/self-reflection.ts"],
      },
    ],
    requiredCategories: ["normal"],
  },
  {
    name: "Mikros",
    note: "One provider call/turn invariant — asserted via provider-call-count spies in model-workflow.test.ts/chat-logic.test.ts.",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/simple-task-detector.test.ts", "src/tests/effort.test.ts", "src/tests/chat-logic.test.ts"],
        sourceFiles: ["src/lib/server/simple-task-detector.ts", "src/lib/effort.ts", "src/lib/server/model-workflow.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "edge"],
  },
  {
    name: "Kanon",
    note: "Exactly-one-call-per-turn invariant across Low/Medium/High effort — see aof-web/CLAUDE.md 'Kanon invariant'.",
    targets: [
      {
        project: "aof-web",
        testFiles: ["src/tests/model-workflow.test.ts", "src/tests/phase-stream.test.ts"],
        sourceFiles: ["src/lib/server/model-workflow.ts", "src/lib/server/phase-stream.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "failure"],
  },
  {
    name: "Ypertatos",
    note: "2+N buffered-call invariant (RAA -> TMAP -> N agents -> 1 streamed answer); N=0 degrade paths asserted in prestream-dispatch.test.ts.",
    targets: [
      {
        project: "tmap-v2",
        testFiles: ["src/tests/ypertatos.test.ts", "src/tests/titan.test.ts"],
        sourceFiles: ["src/core/ypertatos.ts"],
      },
    ],
    requiredCategories: ["normal", "boundary", "failure", "recovery"],
  },
];
