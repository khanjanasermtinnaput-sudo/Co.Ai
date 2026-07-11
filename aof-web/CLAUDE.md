# aof-web

## UI contrast rule (hard requirement)

Never let a text color and its background/surface color resolve to the same or
near-same value, in either theme. This has caused real bugs (e.g. `.glass-strong`
in `globals.css` was hardcoded to a near-black fill with no light-mode variant,
making `text-foreground`/`text-popover-foreground` unreadable on it in Light mode —
affecting every tooltip, dropdown menu, dialog, and toast).

When adding or touching UI:
- Any custom surface utility (like `.glass`, `.glass-strong` in `src/app/globals.css`)
  must define both a base (light) rule and a `.dark` override — never a single
  hardcoded fill shared across themes.
- When pairing a `bg-*`/`background`/`style={{ backgroundColor }}` with text, use
  matched design tokens (`bg-card` + `text-card-foreground`, `bg-popover` +
  `text-popover-foreground`, etc.) rather than mixing an arbitrary background with
  an unrelated text token.
- For text on a *dynamic* background color (e.g. per-user avatar colors), don't
  hardcode `text-white`/`text-black` — pick based on the background's luminance.
  See `readableTextColor()` in `src/lib/utils.ts`.
- Before merging any visual change, check it in both Light and Dark theme
  (Settings → Appearance in the app, or `next-themes`' `useTheme()`).
