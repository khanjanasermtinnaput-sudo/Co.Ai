# Co.Ai Design System

> Clean. Calm. Developer-grade. AI-native.

This design system adapts the strongest principles from the provided
Cursor design analysis---quiet visual language, warm neutral surfaces,
disciplined typography, compact developer-tool controls, deliberate
spacing, restrained elevation, and contextual AI visualization---while
removing third-party brand identity and adapting the system to Co.Ai.

## 1. Design Direction

Co.Ai is a powerful AI work environment, not a generic chatbot and not a
clone of another developer tool.

The visual direction is:

-   Quiet confidence
-   Minimal visual noise
-   Developer-grade precision
-   AI-native context
-   Content-first hierarchy
-   Calm, fast, professional interaction

The interface should communicate:

> The system is powerful enough to be complex, so the interface does not
> need to be.

The default experience hides complexity. Advanced power is available
when the user needs it.

## 2. Core Principles

### Content over decoration

The interface exists to help users think, create, build, review, and
ship.

Avoid visual elements that do not improve understanding, navigation,
task completion, context, feedback, or trust.

Avoid:

-   Excessive gradients
-   Excessive glassmorphism
-   Decorative glow
-   Unnecessary shadows
-   Excessive animation
-   Large decorative backgrounds
-   Cards inside cards inside cards
-   Unnecessary badges
-   Visual noise

### Hide complexity, reveal power progressively

Co.Ai contains complex internal systems including model routing, Mikros,
Kanon, Ypertatos, Titan, effort levels, RAA, TMAP, orchestration,
provider routing, tools, memory, workflows, validation, and review
loops.

These systems remain powerful but should not overwhelm normal users.

Default experience:

``` text
User intent
    ↓
Co.Ai understands
    ↓
Co.Ai chooses the appropriate system
    ↓
User sees useful progress
    ↓
User receives a result
```

Advanced users may reveal:

``` text
Model
Effort
Workflow
Tools
Context
Memory
Diagnostics
```

Use progressive disclosure everywhere.

### User intent over internal architecture

Organize the UI around what the user wants to accomplish.

Prefer:

-   Build
-   Understand
-   Verify
-   Review
-   Ship

Over exposing:

-   RAA
-   TMAP
-   Orchestrator
-   Provider Router
-   Workflow Runner

Internal architecture may be visible in advanced detail views, but
should not define the default experience.

### Calm interfaces for focused work

When users are reading, writing, coding, or reviewing:

-   Reduce motion
-   Reduce visual noise
-   Keep hierarchy clear
-   Keep controls predictable
-   Avoid competing visual elements

Motion should communicate state, not decorate the interface.

## 3. AI-Native Interaction

Co.Ai should be designed around:

``` text
Intent
  ↓
Context
  ↓
Plan
  ↓
Action
  ↓
Evidence
  ↓
Result
  ↓
Approval / Recovery
```

The interface should help users understand:

1.  What Co.Ai understood
2.  What context it used
3.  What it plans to do
4.  What it actually did
5.  What evidence supports the result
6.  What the result is
7.  What the user can do next
8.  How to recover if something fails

Do not expose private chain-of-thought.

Show concise useful explanations instead:

-   Goal understood
-   Files affected
-   Actions taken
-   Tests run
-   Evidence found
-   Result produced
-   Next action

## 4. Product Architecture

### Unified Co.Ai workspace

Chat and Code are different views of one workspace.

``` text
Co.Ai Workspace
├── Chat
├── Code
├── Projects
├── Activity
└── Context
```

Context should be preserved when moving between:

``` text
Conversation
    ↓
Plan
    ↓
Files
    ↓
Code
    ↓
Preview
    ↓
Tests
    ↓
Review
```

The user should not feel like they are switching between unrelated
applications.

### Global application shell

Primary navigation should be minimal:

``` text
Co.Ai

New
Chat
Code / Projects
Activity

Settings
```

Advanced functionality should be accessed through contextual panels,
project navigation, Command Palette, context menus, and relevant
actions.

Do not expose every internal capability in the global sidebar.

### Three-part workspace

``` text
┌──────────────┬────────────────────────────┬──────────────┐
│ Global       │                            │ Contextual   │
│ Navigation   │     Main Workspace         │ AI / Tools   │
│              │                            │ Panel        │
└──────────────┴────────────────────────────┴──────────────┘
```

The contextual panel should appear when relevant and should not
permanently consume attention.

## 5. Color System

The color system is restrained and semantic.

Co.Ai must define its own accent and must not copy a third-party brand
color or identity.

``` yaml
colors:
  canvas: "Co.Ai neutral canvas"
  canvas-soft: "Subtle secondary canvas"
  surface: "Primary panel surface"
  surface-raised: "Raised surface where necessary"
  surface-strong: "Strong neutral surface"
  ink: "Primary warm near-black text"
  body: "Default body text"
  muted: "Secondary text"
  muted-soft: "Disabled or tertiary text"
  border: "Default hairline"
  border-soft: "Subtle hairline"
  border-strong: "Emphasized border"
  accent: "Co.Ai brand accent"
  accent-active: "Pressed/active accent"
  on-accent: "Text/icon on accent"
  success: "Success state"
  warning: "Warning state"
  error: "Error state"
  info: "Informational state"
```

Rules:

-   Neutral surfaces are the foundation.
-   Use one primary Co.Ai accent.
-   Do not introduce multiple competing brand colors.
-   Semantic colors communicate meaning.
-   AI activity colors remain scoped to AI visualization.
-   Do not use timeline colors as arbitrary system action colors.

## 6. AI Activity Color System

AI activity visualization may use a restrained pastel stage palette.

Recommended stages:

``` text
Understanding
Planning
Building
Validating
Reviewing
Completed
```

Example token structure:

``` yaml
ai_activity:
  understanding: "Soft warm neutral"
  planning: "Soft blue"
  building: "Soft lavender"
  validating: "Soft mint"
  reviewing: "Soft gold"
  completed: "Co.Ai success"
```

These colors primarily appear in AI activity timelines, workflow
summaries, progress indicators, stage pills, and AI execution history.

Do not spread them across unrelated UI.

## 7. Typography

Typography should feel calm, precise, and mature.

Recommended sans stack:

``` css
Inter,
system-ui,
-apple-system,
BlinkMacSystemFont,
"Segoe UI",
sans-serif
```

Code surfaces:

``` css
"JetBrains Mono",
"Fira Code",
ui-monospace,
SFMono-Regular,
monospace
```

### Hierarchy

  Token              Size   Weight   Line Height Use
  ------------ ---------- -------- ------------- ------------------------
  display-xl     56--72px      400           1.1 Major product headings
  display-lg         36px      400           1.2 Page headings
  display-md         26px      400          1.25 Section headings
  display-sm         22px      400           1.3 Group headings
  title-lg           18px      600           1.4 Component titles
  title-md           16px      600           1.4 List and panel labels
  body-lg            16px      400           1.5 Main body
  body-md            14px      400           1.5 Default UI body
  body-sm            13px      400           1.5 Secondary text
  caption            12px      400           1.4 Supporting metadata
  label              11px      600           1.4 Compact labels
  code               13px      400           1.5 Code surfaces
  button         13--14px      500           1.0 Controls

Rules:

-   Display weight generally remains 400.
-   Negative letter spacing is reserved for large display text.
-   Do not use bold everywhere.
-   Use weight to create hierarchy.
-   Use monospace for code and technical data.
-   Avoid excessive uppercase text.

## 8. Spacing

Use a 4px base unit.

``` yaml
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 20px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px
```

Application UI should prioritize compact productivity spacing.

Large editorial spacing may be used for empty states, onboarding,
product overview surfaces, and major section transitions.

Do not force marketing-site spacing into dense developer workflows.

## 9. Layout

Application layout:

``` text
Application Shell
├── Global Sidebar
├── Workspace Header
├── Main Workspace
└── Contextual Panel
```

Content width should be contextual:

-   Wide layouts for code and project work
-   Constrained readable widths for chat and prose
-   Flexible panels for AI workflows
-   Full-width workspace for editor surfaces

Do not force every screen into the same max-width container.

### Responsive behavior

Mobile:

-   Collapse global navigation
-   Use a single primary workspace
-   Convert contextual panels into drawers or sheets
-   Keep primary actions visible
-   Preserve task context

Tablet:

-   Compress navigation
-   Allow contextual panels to collapse
-   Preserve editor usability

Desktop:

-   Full workspace layout
-   Resizable panels where useful
-   Keyboard-first interaction
-   Command Palette access

## 10. Elevation and Depth

Use restrained depth.

``` text
Canvas
  ↓
Surface
  ↓
Hairline border
  ↓
Raised surface only when necessary
```

Prefer:

-   1px borders
-   Surface contrast
-   Subtle background shifts
-   Strong hierarchy

Shadows may be used only when required for dialogs, floating popovers,
menus, or elements crossing major surfaces. Keep them subtle.

## 11. Shapes

``` yaml
radius:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px
```

Recommended usage:

-   Compact rows: 4--6px
-   Buttons and inputs: 6--8px
-   Panels and cards: 8--12px
-   Large surfaces: 12--16px, rarely
-   Pills and status tags: full pill

Avoid making every element heavily rounded.

## 12. Core Components

### Buttons

Primary: Co.Ai accent, strong contrast, compact height, clear label.

Secondary: neutral surface, hairline border, primary text.

Tertiary: transparent, text/icon only.

Destructive: semantic error treatment and appropriate confirmation for
irreversible actions.

### Inputs

Inputs should be clear, compact, keyboard accessible, and strongly
focused when active.

Default:

``` text
Neutral surface
Hairline border
Clear text
Visible focus state
```

### Panels

Every panel should have a clear purpose.

Ask:

> Why is this panel open?

Avoid panels that exist only because a feature exists.

### Cards

Do not use cards as the default container for everything.

Use cards for grouped information, distinct actions, summaries, project
objects, AI plans, and review results.

Prefer flat layout and hairline separation when content is already
related.

### Badges

Use badges for status, state, and compact metadata.

Do not use badges as decoration.

## 13. Command Palette

Command Palette is a first-class Co.Ai interaction layer.

Recommended shortcut:

``` text
⌘ / Ctrl + K
```

Actions include:

-   New chat
-   Open project
-   Search projects
-   Search files
-   Ask Co.Ai
-   Run tests
-   Review changes
-   Open AI activity
-   Open settings
-   Open advanced tools
-   Navigate anywhere

It should make advanced functionality discoverable without polluting
main navigation.

## 14. Chat

Chat should feel like a focused AI work environment.

Priorities:

1.  Readability
2.  Context
3.  Clear AI state
4.  Useful actions
5.  Low visual noise

Support:

-   Streaming
-   Attachments
-   Sources
-   Rich content
-   Code
-   Actions
-   Errors
-   Retry
-   Conversation history
-   Context awareness

The interface should not feel like a generic messaging application.

## 15. Composer

The Composer is one of the most important surfaces.

Default:

``` text
Ask Co.Ai what you want to accomplish...
```

Keep the default experience simple.

Advanced controls are progressively revealed:

``` text
Auto
  ↓
Model
Effort
Context
Tools
Workflow
Memory
```

Users should be able to express intent without understanding internal
architecture.

Expert users should be able to access deeper controls.

## 16. AI Workflow

Default workflow language:

``` text
Understanding
    ↓
Planning
    ↓
Building
    ↓
Validating
    ↓
Reviewing
    ↓
Completed
```

Do not expose internal agent names as the primary progress experience.

Advanced details may reveal:

-   Files affected
-   Tools used
-   Tests run
-   Evidence found
-   Actions completed
-   Result summary

Never expose private chain-of-thought.

## 17. CoCode

CoCode is a coherent AI development workspace.

``` text
Build
├── Files
├── Editor
├── AI
└── Preview

Understand
├── Architecture
├── Dependencies
└── Semantic Search

Verify
├── Tests
├── Coverage
├── Security
├── Accessibility
└── Performance

Ship
├── GitHub
├── CI/CD
├── Environment
└── Deployment
```

These are conceptual groupings, not necessarily permanent navigation
items.

Advanced features should appear contextually.

The editor and active task remain the focus.

## 18. Project System

Projects are central context containers.

``` text
Project
├── Overview
├── Chat
├── Files
├── Code
├── Activity
├── Tests
├── Review
└── Deploy
```

Project context should inform:

-   AI conversations
-   Files
-   Memory
-   Plans
-   Activity
-   Reviews
-   Checkpoints

## 19. AI Trust and Feedback

Show:

-   What was understood
-   What will happen
-   What happened
-   What changed
-   What was verified
-   What failed
-   What can happen next

For errors:

``` text
What happened
Why it happened
What Co.Ai tried
What can be done next
Retry / Fix / Review
```

Recovery is a first-class interaction.

Avoid generic:

``` text
Something went wrong.
```

## 20. TaoTao and Brand Personality

TaoTao should support Co.Ai identity without distracting from work.

Appropriate locations:

-   Onboarding
-   Empty states
-   Success states
-   Helpful recovery states
-   Brand moments

During focused coding, reading, and reviewing, the interface should
remain quiet.

## 21. Motion

Motion should communicate:

-   State changes
-   Progress
-   Hierarchy
-   Feedback

Respect:

``` text
prefers-reduced-motion
```

Motion should be fast for direct interaction, subtle for panel
transitions, calm for AI progress, minimal for background elements, and
never an unnecessary loop.

## 22. Accessibility

Every UI surface must support:

-   Keyboard navigation
-   Visible focus states
-   Logical tab order
-   Screen readers
-   Sufficient contrast
-   Reduced motion
-   Semantic HTML
-   Accessible labels
-   Appropriate touch targets

Accessibility is part of the design system.

## 23. Design Governance

This file is the source of truth for the Co.Ai visual system.

Every new UI change must:

-   Reuse existing tokens
-   Reuse existing primitives where possible
-   Avoid duplicate components
-   Follow established spacing
-   Follow typography rules
-   Follow interaction patterns
-   Follow responsive behavior
-   Follow accessibility rules
-   Follow AI state semantics

Before creating a new component, ask:

> Can an existing component be extended or composed instead?

If yes, reuse it.

If no, create the smallest reusable component that solves the actual
problem.

Avoid one-off visual systems.

## 24. Business Logic Preservation

This design system controls the presentation and interaction layer.

The following systems must be preserved unless a UI integration change
is strictly required:

-   AI model routing
-   Mikros
-   Kanon
-   Ypertatos
-   Titan
-   Effort logic
-   RAA
-   TMAP
-   Orchestration
-   Workflow execution
-   Provider systems
-   API contracts
-   Database schemas
-   Authentication
-   Memory
-   Chat history
-   Project data
-   Core application behavior

The goal is:

> Replace the experience layer without destroying the product brain.

## 25. Design Quality Bar

Evaluate every major surface using:

``` text
Clarity
Hierarchy
Discoverability
Cognitive Load
Consistency
Responsiveness
Accessibility
Performance
AI Transparency
Task Completion
Visual Quality
```

The final product should feel:

> Clean enough to disappear. Powerful enough to trust.

Co.Ai should not look like a generic AI chatbot.

It should feel like a serious AI work environment with its own identity.

## 26. Reference Adaptation Rule

The provided Cursor design analysis is a reference for principles, not a
specification to copy.

Adopt the underlying principles where they improve Co.Ai:

-   Quiet visual language
-   Warm neutral surfaces
-   Disciplined typography
-   Compact professional controls
-   Deliberate spacing
-   Restrained elevation
-   Hairline-based separation
-   Contextual AI visualization
-   Calm developer-tool atmosphere

Do not copy:

-   Third-party brand identity
-   Third-party logo or wordmark
-   Third-party brand color
-   Third-party font identity
-   Third-party product naming
-   Exact visual identity
-   Exact layout
-   Exact component designs
-   Third-party marketing structure

The final result must be distinctly Co.Ai.

## 27. Final Rule

The UI may be redesigned substantially.

The underlying product brain must remain intact.

``` text
New Co.Ai Experience
        ↓
Existing Co.Ai Capabilities
        ↓
Existing AI Brain
```

Change the interface.

Improve the experience.

Preserve the system.
