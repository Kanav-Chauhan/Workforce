# Office preview brief (Phase 2a)

Goal: the owner picks the look of the Workforce office. Build ONE self-contained, clickable static preview
that plays a scripted story on a loop with fake data. No server, no real agents. It must look **polished and
beautiful, NOT pixel art** (the owner explicitly rejects the retro pixel look of JSM HQ's office).

## Hard rules
- Static files only, in your folder (`previews/office-a/` or `previews/office-b/`), entry `index.html`.
- **No CDNs, no external requests, no web fonts from Google.** Any library is vendored as a file in your folder
  (e.g. get it with `npm pack <pkg>@<exact version>` in a scratch dir and copy the built file). System font stack is fine.
- Original art only, made in code (SVG / canvas / three.js geometry). Do not copy anything from JSM HQ.
- Works on a laptop and a phone (≥ 360 px wide): drag to pan, pinch/scroll to zoom or a sensible fixed fit.
- Light, calm look (off-white, soft greys, one accent; soft shadows). Smooth 60 fps animation, eased movement.
- Plain English labels. Keep it under ~1,500 lines of your own code.

## The office (what must be on screen)
- **Cabins**, one per person, each with a glass front so you see inside: desk, chair, a screen, a nameplate, a status light.
  - **CEO cabin** — "You (CEO)", bigger, corner office.
  - **Simha ♌ Lead** — lead's cabin, next to the plan wall.
  - **Mesha ♈ Worker**, **Kanya ♍ Worker** — worker cabins.
- **People**: friendly stylised characters (not robots, not pixel sprites), each with their own colour
  (Simha gold/amber, Mesha red-coral, Kanya green-teal; the CEO slot is empty/your chair). They walk along a corridor
  between cabins with eased paths, sit at their desk when working, type (hands/screen flicker).
- **Their screen** shows what they're doing as short text ("editing page.tsx", "running tests", "idle").
- **Plan wall**: 4 columns To do / Working / Review / Done with sticky notes (task IDs) that glide between columns.
- **Review gate**: PRs are little parcels/folders carried from a cabin to a review gate; on merge → small celebration
  (confetti or sparkle) and the note slides to Done.
- **Lounge** with a coffee machine: idle people go for coffee or wander.
- **Speech bubbles** when two people talk; an envelope/message effect is fine too.
- Hover/click a person or cabin → a right-hand side panel (stub) with name, role, status, current task, last 3 actions,
  and a fake terminal box.

## Around the office (HUD, light and minimal)
- Top bar: "Workforce · demo-repo", status chips ("2 working · 1 needs you").
- **Needs you** strip at the top: appears when an agent waits at the CEO cabin — e.g. "Mesha wants to run
  `npm install zod`" with Allow / Deny buttons. Clicking Allow sends Mesha back to her cabin.
- Right column: Activity feed (time + line) and a "Message the lead" box (typing + Enter replays step 1).
- On phones, the right column becomes a bottom sheet/tab.

## Scripted story (loop, ~60–90 s, also restartable)
1. Owner message "Add a /health page and a footer" → envelope from CEO cabin to Simha.
2. Simha walks to the plan wall, two notes appear in To do (WF-1, WF-2).
3. Simha **walks to Mesha's cabin**, bubble "WF-1 is yours: /health page", Mesha replies "On it", Simha walks to Kanya's cabin likewise (WF-2 footer), then back to his own cabin.
4. Mesha and Kanya sit, type; notes move to Working; screens show "editing app/health/page.tsx", "editing Footer.tsx".
5. Mesha **walks to the CEO cabin** and waits with bubble "May I run npm install zod?" → Needs you strip appears
   (auto-Allow after ~6 s if not clicked) → she walks back.
6. Kanya finishes: carries a parcel "PR #4" to the review gate; note → Review.
7. Kanya walks to Simha's cabin: "PR #4 ready". Simha: "Owner will merge."
8. Merge: celebration, WF-2 → Done. Kanya goes for coffee in the lounge.
9. Mesha's PR #5 the same way, then both idle/wander. Loop restarts after a short pause.

## Deliver
- The page, a one-paragraph `NOTES.md` (what tech, total size, anything not done), and a desktop + phone screenshot
  (headless Chromium is available: check `which chromium chromium-browser google-chrome` or use playwright if present)
  saved as `shot-desktop.png` / `shot-phone.png` in your folder. Look at your screenshots and fix ugly bits before finishing.
