// ── Refactoring operations (Phase 19) ────────────────────────────────────────

export type RefactorKind =
  | "rename-symbol"
  | "extract-component"
  | "extract-hook"
  | "extract-function"
  | "move-file"
  | "merge-components"
  | "js-to-ts"
  | "css-to-tailwind"
  | "remove-dead-code";

export interface RefactorOperation {
  kind: RefactorKind;
  label: string;
  description: string;
  requiresAI: boolean;
}

export const REFACTOR_OPERATIONS: RefactorOperation[] = [
  {
    kind: "rename-symbol",
    label: "Rename Symbol",
    description: "Rename across all files, updating imports automatically",
    requiresAI: false,
  },
  {
    kind: "extract-component",
    label: "Extract Component",
    description: "Extract selected JSX into a new React component",
    requiresAI: true,
  },
  {
    kind: "extract-hook",
    label: "Extract Hook",
    description: "Extract stateful logic into a custom hook",
    requiresAI: true,
  },
  {
    kind: "extract-function",
    label: "Extract Function",
    description: "Extract selected code block into a named function",
    requiresAI: true,
  },
  {
    kind: "move-file",
    label: "Move File",
    description: "Move file and update all import paths",
    requiresAI: false,
  },
  {
    kind: "js-to-ts",
    label: "Convert JS → TypeScript",
    description: "Add types and convert .js/.jsx to .ts/.tsx",
    requiresAI: true,
  },
  {
    kind: "css-to-tailwind",
    label: "Convert CSS → Tailwind",
    description: "Replace CSS classes with Tailwind utility classes",
    requiresAI: true,
  },
  {
    kind: "remove-dead-code",
    label: "Remove Dead Code",
    description: "Identify and remove unused imports, variables, functions",
    requiresAI: true,
  },
];
