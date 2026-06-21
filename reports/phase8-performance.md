# Phase 8 — Performance Audit

**Audited:** React rendering, bundle, DB queries, caching, streaming, agent routing, memory retrieval. **Looking for:** N+1 queries, large re-renders, blocking ops, duplicate fetches, unnecessary state updates.

---

## Verdict

The app is already well-architected for performance (granular store selectors, parallel DB calls, batch upserts). One **clearly-correct, low-risk win applied** (memoize chat messages); a couple of larger items **documented** rather than risk-changed.

---

## Findings & actions

### P8.1 — Chat messages re-rendered on every streaming token → FIXED
- **Finding:** `chat-message.tsx`'s `ChatMessage` was un-memoized. `chat-store.appendToken` replaces only the active assistant message object per token, but without memo **every** message in the thread re-rendered on **every** token → O(messages) work per token (markdown re-parse included).
- **Why memo is safe here:** during streaming, `onEdit`/`onRegenerate` are `undefined` for all messages (`!streaming` is false) and every non-streaming `message` keeps referential identity (the store maps `m.id === assistantId ? {…} : m`). So default shallow prop comparison correctly skips all non-streaming messages and re-renders only the streaming one.
- **Fix:** `export const ChatMessage = memo(ChatMessageImpl)`. Per-token cost drops from O(messages) → O(1).
- **Files:** `aof-web/src/components/chat/chat-message.tsx`.
- **Risk:** none — markdown re-parse for long replies during streaming is the heaviest cost this removes; behavior identical.

### Confirmed already-good (no change)
| Area | Evidence |
|------|----------|
| **Store selectors** | `chat-view.tsx` uses granular `useChatStore((s) => s.field)` selectors — no whole-store subscriptions, no over-render. |
| **API DB calls** | Admin enrichment uses `Promise.all` (parallel, not serial); `[id]/route.ts` batches role/sub/beta with one `Promise.all`. |
| **Batch writes** | `conversations/[id]/messages` uses a single `.upsert(rows)` — no per-row inserts. |
| **Provider health** | `/api/health` pings providers in parallel via `Promise.all`. |
| **Search** | Postgres FTS (`tsvector`/`tsquery`) server-side with prefix matching — not client scans; `limit` capped at 20. |
| **localStorage** | chat persist `partialize` truncates to last 20 msgs/conversation — bounded storage. |

---

## Documented (not auto-changed)

### P8.2 — `appendToken` allocates new arrays per token (LOW)
`chat-store.appendToken` rebuilds the `conversations` array + active conversation's `messages` array on each token. With P8.1's memo, the **render** cost is now O(1), so the residual is only allocation/GC churn in the store — negligible for normal threads. A token-batching flush (e.g. coalesce per animation frame) would cut allocations further but slightly changes streaming cadence and touches tested store behavior → deferred. **Recommend** only if profiling shows GC pressure on very long replies.

### P8.3 — Admin email enrichment is N parallel `getUserById` calls (LOW)
`admin/roles`, `admin/subscriptions`, `admin/redeem-codes/[id]` enrich emails via `Promise.all(ids.map(getUserById))`. Emails live in GoTrue `auth.users`, which the admin API exposes per-id (or via paginated `listUsers`) — there is no clean single `.in()` for `auth.users`. N is bounded (only rows with a role/subscription, and admin pages paginate), so this is acceptable. **Recommend** a short-TTL email cache only if admin lists grow large.

### Bundle
`lucide-react` (named icon imports — tree-shakeable), `framer-motion`, `react-markdown` all imported by name; no server-only lib leaks into client components observed (server code isolated under `lib/server/*` + route handlers). No action.

---

## Output format (per directive)

1. **Findings:** 1 real render hot-spot (un-memoized messages); 2 LOW residuals documented; rest already optimal.
2. **Root cause:** P8.1 — missing `React.memo` on a list item updated by sibling state.
3. **Files affected:** `aof-web/src/components/chat/chat-message.tsx`.
4. **Changes made:** memoized `ChatMessage`.
5. **Risks:** none — props proven referentially stable during streaming.
6. **Validation evidence:** aof-web `tsc` clean · `next lint` clean · 178/178 tests. (tmap-v2 untouched this phase — still 432/436.)

---

### ✅ Phase 8 complete — proceeding to Phase 9 (AI System Verification).
