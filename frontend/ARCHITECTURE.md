# Frontend Architecture

## Current state

Frontend already split into files, but boundaries are weak:

- `app.js` is the composition root and also holds app state, money logic, auth flow, DOM wiring and trader actions.
- cabinet-oriented modules (`cabinet.js`, `quests.js`, `playerNotes.js`, `history.js`, `master-room.js`) duplicated the same helpers for auth headers, `localStorage`, text formatting and soft API fallback.
- many modules still coordinate through `window.*`, which makes the next feature risky because side effects are hard to trace.

## Minimal module layout

Do not split further into many files yet. The practical target is:

1. `app.js`
   Main orchestrator for trader flow, auth flow, global state bridges and top-level event wiring.

2. `render.js`
   Pure-ish rendering and modal interaction for traders, cart and inventory. It should consume state/actions, not own business rules.

3. `cabinet.js`
   Cabinet shell and tab composition. It should decide which cabinet submodule renders, but not duplicate infra helpers.

4. `shared.js`
   Shared runtime utilities for cabinet-family modules:
   DOM lookup, auth headers, `localStorage` helpers, soft API wrappers, date/text helpers, user-scoped keys.

5. feature modules
   Keep existing feature files (`quests.js`, `playerNotes.js`, `history.js`, `maps.js`, `bestiari.js`, `master-room.js`, `longstoryshort.js`) as the last layer. They should focus on one feature each.

## Why this is enough for the next feature

- We remove low-value duplication without rewriting the frontend.
- The next feature can attach either to `app.js` or `cabinet.js` and reuse `shared.js` instead of copying helper code again.
- This keeps refactor cost low while improving predictability.

## Recommended next step

Before adding the next feature, continue in this order:

1. reduce `window.*` bridges around trader actions into a smaller action surface
2. move `app.js` money/cart/trader business logic into one dedicated trader-domain module
3. only after that, add the new feature
