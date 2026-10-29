---
name: ui-ux
user-invocable: false
paths: ["src/ui/**", "index.html", "styles.css"]
description: The UI rules a builder reads before a UI slice (files under src/ui/, index.html, styles.css) and the UX manual checks the slice adds to docs/MANUAL-CHECKS.md. Adapted from UI UX Pro Max (MIT). Used by implement-slice, build-slices and the builder agent.
---

# UI and UX rules for a slice

Adapted from UI UX Pro Max by nextlevelbuilder (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT), reduced to what a small plain-JavaScript app needs: its ten priority categories, kept in its order, with one or two checks each. The full skill has a searchable database of styles, palettes, fonts and 119 UX guidelines; this file carries only the rules a slice must keep, and says when to use the full one.

## The checklist, run on every UI slice, in this order
1. **Accessibility.** Text against its background at least 4.5:1 (large text 3:1). A visible focus ring on every interactive element; never `outline: none` without a replacement. Every input has a `<label for>`; an icon-only button has an `aria-label`. Everything reachable and usable with the keyboard alone, in the visual order.
2. **Touch and interaction.** Targets at least 44 by 44 px with 8 px between them. A button that starts work shows it (disabled plus a visible state) until the work ends. Nothing depends on hover alone.
3. **Layout.** Mobile first: the page works at 320 px wide with no horizontal scroll, then widens. `<meta name="viewport" content="width=device-width, initial-scale=1">`, zoom never disabled.
4. **Typography and color.** Body text 16 px or more, line-height 1.5. Colors are semantic tokens defined once in `styles.css` (`--color-text`, `--color-surface`, `--color-error`, ...); no raw hex in a component or in `src/ui/`. Meaning never by color alone: an error has text or an icon too.
5. **Forms and feedback.** A visible label on every field, not a placeholder. The error next to the field it belongs to, saying what is wrong and how to fix it; helper text under a field that needs it. Validate on blur or submit, not on every keystroke.
6. **Empty, error and loading states.** Every list and every form has them: an empty list says what to do first, a failed save says what failed and what to do, a wait longer than a moment shows it.
7. **Navigation.** Back is predictable: it returns where the user came from and keeps what was typed or filtered. The current place is marked.
8. **Motion.** Short, with a meaning (what moved and why); `transform` and `opacity` only; nothing moves when `prefers-reduced-motion: reduce` is set.
9. **Icons.** No emoji as icons; inline SVG only, one set, decorative icons `aria-hidden="true"`.
10. **Performance.** No layout shift: images and async content get their space reserved; no work on the main thread the user has to wait for.

Rules 1, 3, 4 and 5 are the ones a user hits first; when a slice cannot keep one of them inside its files, stop and say so in the report (`NEEDS HUMAN`), do not widen the slice.

## The manual checks a UI slice adds
A unit test cannot cover these, so the slice adds them to `docs/MANUAL-CHECKS.md`, unticked, as `- [ ] UX: ...` lines next to its `- [ ] R-xx: ...` lines. Six lines, always:

```
- [ ] UX: keyboard only, from the first field to the outcome, focus visible at every step
- [ ] UX: 200% browser zoom, nothing cut off, no horizontal scroll
- [ ] UX: contrast 4.5:1 on text, 3:1 on large text and borders (browser devtools)
- [ ] UX: empty states: an empty list and an empty form say what to do
- [ ] UX: a validation error appears next to its field and says how to fix it
- [ ] UX: 320 px wide, every screen of the slice, no horizontal scroll
```

A `UX:` line carries no requirement id, so `tools/trace.mjs` and the gate count it neither as a requirement nor as an orphan; the human ticks it like the others before the pull request. A UI slice committed without these lines is a `contract` finding (advisory) in the review (`finder-contract` item 10).

## When the full UI UX Pro Max skill is installed
The full skill lives at `$HOME/.claude/skills/ui-ux-pro-max/` when installed; this file does not need it. Use it for a decision this file does not settle, a style or a palette, with one search per question:

```sh
python3 "$HOME/.claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain ux
```

(`--domain color`, `--domain typography` and `--domain style` for a palette, a font pairing, a style.) A style or palette choice is an architectural decision, not the builder's: record it in an ADR from `templates/ADR.md` (`docs/decisions/ADR-nnn-ui-style.md`, the human writes it), and the tokens in `styles.css` follow that ADR. The builder does not run the search inside a slice; it writes `NEEDS HUMAN` and stops.
