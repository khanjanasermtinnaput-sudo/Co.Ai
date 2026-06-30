// ── Code Translator (Phase 43) ────────────────────────────────────────────────
// Translates code between languages and frameworks via AI prompting.
// Detects source language from file extension and content heuristics.

export type CodeLanguage =
  | "typescript" | "javascript" | "python" | "go" | "rust"
  | "java" | "csharp" | "php" | "ruby" | "swift" | "kotlin";

export type UIFramework = "react" | "vue" | "svelte" | "angular" | "none";

export interface TranslationTarget {
  language: CodeLanguage;
  framework: UIFramework;
  label: string;
}

export const TRANSLATION_TARGETS: TranslationTarget[] = [
  { language: "typescript", framework: "react", label: "TypeScript + React" },
  { language: "javascript", framework: "react", label: "JavaScript + React" },
  { language: "typescript", framework: "vue", label: "TypeScript + Vue 3" },
  { language: "typescript", framework: "svelte", label: "TypeScript + Svelte" },
  { language: "python", framework: "none", label: "Python" },
  { language: "go", framework: "none", label: "Go" },
  { language: "rust", framework: "none", label: "Rust" },
  { language: "java", framework: "none", label: "Java" },
  { language: "csharp", framework: "none", label: "C#" },
  { language: "swift", framework: "none", label: "Swift" },
  { language: "kotlin", framework: "none", label: "Kotlin" },
  { language: "php", framework: "none", label: "PHP" },
];

const EXT_MAP: Record<string, CodeLanguage> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  py: "python", go: "go", rs: "rust",
  java: "java", cs: "csharp", php: "php",
  rb: "ruby", swift: "swift", kt: "kotlin",
};

export function detectLanguage(filePath: string, content: string): CodeLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  // Heuristics
  if (content.includes("import React") || content.includes("useState")) return "typescript";
  if (content.includes("def ") && content.includes(":")) return "python";
  if (content.includes("func ") && content.includes("package ")) return "go";
  if (content.includes("fn ") && content.includes("->")) return "rust";
  return "javascript";
}

export function detectUIFramework(content: string, lang: CodeLanguage): UIFramework {
  if (lang !== "typescript" && lang !== "javascript") return "none";
  if (content.includes("from 'react'") || content.includes('from "react"') || content.includes("React.")) return "react";
  if (content.includes("from 'vue'") || content.includes("<template>")) return "vue";
  if (content.includes("from 'svelte'") || content.includes("<script lang=")) return "svelte";
  if (content.includes("@Component") || content.includes("@NgModule")) return "angular";
  return "none";
}

export function buildTranslationPrompt(
  sourceCode: string,
  sourceLang: CodeLanguage,
  sourceFramework: UIFramework,
  target: TranslationTarget,
): string {
  const sourceLabel = sourceFramework !== "none"
    ? `${sourceLang} + ${sourceFramework}`
    : sourceLang;

  const targetLabel = target.label;

  const frameworkNotes: Partial<Record<UIFramework, string>> = {
    react: "Use functional components with hooks. Export as named export. Use TypeScript types/interfaces.",
    vue: "Use Composition API with <script setup lang='ts'>. Single File Component format.",
    svelte: "Use Svelte 5 syntax with runes ($state, $derived, $effect). Single File Component format.",
    angular: "Use Angular 17+ standalone components with inject() for DI.",
  };

  const langNotes: Partial<Record<CodeLanguage, string>> = {
    python: "Use Python 3.12+ type hints and dataclasses where appropriate.",
    go: "Use idiomatic Go with error returns. No exceptions.",
    rust: "Use idiomatic Rust with Result<T, E> for errors. Include necessary use statements.",
    swift: "Use Swift 5.9+ with async/await for async operations.",
    kotlin: "Use Kotlin coroutines for async operations. Use data classes where appropriate.",
  };

  const extra = (target.framework !== "none" ? frameworkNotes[target.framework] : langNotes[target.language]) ?? "";

  return `Translate the following ${sourceLabel} code to ${targetLabel}.

Requirements:
- Preserve all functionality exactly.
- Use idiomatic ${targetLabel} patterns.
${extra ? `- ${extra}` : ""}
- Output ONLY the translated code. No explanations.
- Preserve comments where they add value.

Source (${sourceLabel}):
\`\`\`
${sourceCode.slice(0, 3000)}
\`\`\``;
}

export function targetFileExtension(target: TranslationTarget): string {
  const extMap: Record<CodeLanguage, string> = {
    typescript: target.framework === "vue" ? "vue" : target.framework === "svelte" ? "svelte" : "ts",
    javascript: target.framework !== "none" ? "jsx" : "js",
    python: "py", go: "go", rust: "rs", java: "java",
    csharp: "cs", php: "php", ruby: "rb", swift: "swift", kotlin: "kt",
  };
  return extMap[target.language] ?? "txt";
}
