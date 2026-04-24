# Manual Test Checklist — MP-2 / MP-3 / Inspector

Scope: Validate the mention pipeline (MP-2), canvas reverse-injection (MP-3),
the InspectorRail (P0-3), and the surrounding polish (layout persistence,
a11y). All steps assume `npm run electron:dev` against a healthy backend, or
`npm run dev` with the demo loader when no backend is available.

> **How to report a failure.** Each step ends with a short "Record as" block.
> Copy it into the bug tracker verbatim, attach (a) a screenshot of the
> composer + chip bar, (b) `localStorage['lattice.session']` exported from
> DevTools, and (c) the `console` tab contents filtered by `[session-store]`
> / `[mention]` / `[toast]`. If the failure is WebSocket-related, include the
> last 50 frames from the Network tab's WS inspector.

---

## Pre-flight

1. Start the app (`npm run electron:dev`). Wait for the status bar to read
   "Backend: ready". If you are testing offline, run `npm run dev` and pick
   "Load Demo: Peak Fit" from the command palette.
2. Open DevTools; confirm no red errors during startup.
3. Clear `localStorage` before test sections A / I to make their assertions
   deterministic; leave it alone for the other sections so you can observe
   rehydrate behaviour.

---

## A. Inspector (P0-3)

### A.1 Peak row → InspectorRail binds

- **Steps**
  1. `Ctrl+Shift+P` → run **"Load Demo: Peak Fit"** (or any command whose
     label contains *Peak Fit*).
  2. Click the first row in the **Peak Table** (bottom panel).
  3. Observe the right-hand InspectorRail.
- **Expected**
  - InspectorRail header reads the peak's label (e.g. *"Peak 1"*).
  - Fields **Position**, **Intensity**, **FWHM**, **Area**, **SNR** are
    populated. Null fields render as `—` (em dash), not "null".
  - The row in the peak table is highlighted (focus ring).
- **Record as**
  ```
  [A.1] peak row selection did not bind InspectorRail
  observed focusedElement: <paste from DevTools: useSessionStore.getState().sessions[...].focusedElement>
  rail header text: <copy>
  ```

### A.2 `Ctrl+Shift+I` toggles visibility

- **Steps**: press `Ctrl+Shift+I` twice.
- **Expected**: rail width animates to 0 then back. `prefs` store shows
  `inspectorVisible` flipping `true ↔ false`.
- **Record as**: `[A.2] inspector toggle — prefs.inspectorVisible did not change`.

### A.3 Switching artifact clears focused element

- **Steps**
  1. With a peak focused (from A.1), click a **different** artifact card in
     the editor (e.g. an `xrd-analysis`).
  2. Inspect `useSessionStore.getState().sessions[active].focusedElement`.
- **Expected**: `focusedElement === null` after the switch; the rail shows
  either the new artifact's summary or its empty-state placeholder.
- **Record as**: `[A.3] focusedElement leaked across artifacts: <ref>`.

### A.4 Deleting the focused artifact clears focused element

- **Steps**
  1. Focus a peak-fit artifact; focus a peak inside it.
  2. Delete the artifact (explorer → context menu → *Delete*).
- **Expected**: `focusedArtifactId` falls back to the next artifact in order
  (or null); `focusedElement` is `null`; InspectorRail does **not** crash or
  leave a dangling header.
- **Record as**: `[A.4] dangling focusedElement after artifact delete: <ref>`.

---

## B. MentionPicker (MP-2)

### B.1 `@` opens picker

- **Steps**: click the composer textarea → type `@`.
- **Expected**: popover opens above/below the caret; within 16 ms the picker
  is fully rendered (check Performance tab if flaky). The query field inside
  the picker is empty.
- **Record as**: `[B.1] picker failed to open on @`.

### B.2 Empty-query groups visible

- **Steps**: with the picker open and the query empty, count group headers.
- **Expected**: four headers in order — **recent** (may be empty, then hidden),
  **focused**, **files**, **artifacts**. Hidden groups must not leave blank
  whitespace.
- **Record as**: `[B.2] picker groups out of order: <observed order>`.

### B.3 Query filtering

- **Steps**: type `pe` with the picker open.
- **Expected**: rows containing "Peak" survive; "phase" rows survive if any
  match substring. Highlighted substrings are visually underlined.
- **Record as**: `[B.3] filter missed row <label>`.

### B.4 MRU recency promotion

- **Steps**
  1. Mention *Peak 1*, send; mention *Peak 3*, send.
  2. Open the picker with query empty.
- **Expected**: **recent** group shows `Peak 3, Peak 1` (newest first).
- **Record as**: `[B.4] recent order <observed>`.

### B.5 Keyboard navigation

- **Steps**: open picker → `↓ ↓ ↓ ↑ Enter` → then reopen and press `Esc`.
- **Expected**: `↑/↓` move highlight with wrap-around; `Enter` inserts the
  highlighted row and closes the picker; `Esc` closes without inserting.
- **Record as**: `[B.5] kbd action <key> did <observed>`.

### B.6 Insert produces token + chip

- **Steps**: pick a peak row.
- **Expected**: textarea value contains `@[Peak 1#abcde] ` (anchor is a
  5-char base36 token); chip bar above composer shows a chip labelled
  `Peak 1` with an `×` button.
- **Record as**: `[B.6] token shape <textarea text>, chip label <label>`.

### B.7 Chip × removes token

- **Steps**: click the `×` on a chip.
- **Expected**: textarea loses the exact `@[label#anchor] ` substring; chip
  disappears. No other text is touched.
- **Record as**: `[B.7] residual text after chip removal: <before|after>`.

### B.8 IME guard — Chinese input must not trigger picker

- **Steps**
  1. Switch OS input method to Chinese (Pinyin).
  2. Start composing a sentence; during composition press the key that maps
     to `@` (on macOS, typically `Shift+2` in ASCII — but while IME is in
     `compositionstart` state).
- **Expected**: picker does **not** open during `compositionstart`/`update`;
  it only opens after `compositionend` commits an `@` glyph as a real key.
- **Record as**: `[B.8] picker opened mid-IME composition`.

---

## C. Send + draft retention

### C.1 Happy path clears composer

- **Steps**: type "hi @[Peak 1#…]", send.
- **Expected**: textarea clears, chip bar clears, textarea height collapses
  back to 36 px (one line).
- **Record as**: `[C.1] composer didn't reset — lingering <text|chip|height>`.

### C.2 Budget block preserves draft

- **Steps**
  1. Settings → LLM → edit the active provider's `perRequest.maxInputTokens`
     to `100`, save.
  2. In the composer paste ~500 characters of text.
  3. Click Send.
- **Expected**: `toast.error` appears ("Input too long — N tokens, budget M");
  textarea text AND chips remain untouched; no message appended to transcript.
- **Record as**: `[C.2] send consumed draft despite budget block`.

### C.3 Cross-session draft isolation

- **Steps**
  1. Start a long request in session A ("explain peak 1 in detail").
  2. Before reply arrives, switch to session B via session switcher; type a
     sentence in session B.
- **Expected**: the reply from A streams into **session A's** transcript only;
  session B's textarea is never touched.
- **Record as**: `[C.3] reply bled into wrong session`.

### C.4 Edit during send preserves user input

- **Steps**
  1. Send a message in session A.
  2. While the assistant is streaming, type additional text in the same
     composer.
- **Expected**: when the stream finishes, the **new text you typed is not
  cleared**. Only the original send should have cleared the composer at the
  moment of submission.
- **Record as**: `[C.4] late-typed text got wiped at stream end`.

---

## D. Round-trip mention

### D.1 Assistant echo renders as chip

- **Steps**: mention `Peak 1` in a prompt that asks the assistant to repeat
  the ref verbatim (e.g. *"Repeat the reference you received verbatim."*).
- **Expected**: the assistant's reply contains an inline chip (not grey text)
  labelled `Peak 1`. Clicking it focuses the peak in the inspector.
- **Record as**: `[D.1] assistant chip rendered as missing/grey`.

### D.2 Deleted artifact greys historical chip

- **Steps**: from D.1, delete the underlying peak-fit artifact.
- **Expected**: the chip in the prior message becomes dimmed ("missing")
  but does **not** disappear; hover tooltip reads "reference no longer exists".
- **Record as**: `[D.2] historical chip state after delete: <observed>`.

---

## E. MentionResolve three states

### E.1 `allow` — full content

- **Steps**: LLM Config → providers → *clawd-proxy* → set
  `mentionResolve='allow'`. Mention an artifact and ask "Repeat its title
  verbatim".
- **Expected**: the LLM reply contains the artifact's real title.
- **Record as**: `[E.1] allow mode leaked <n> chars`.

### E.2 `confirm` — toast.warn lists labels

- **Steps**: set `mentionResolve='confirm'`, mention two peaks, click Send.
- **Expected**: before dispatch a `toast.warn` appears listing the mention
  labels; user has to explicitly confirm in the toast or the send is cancelled.
- **Record as**: `[E.2] confirm toast did not list <labels>`.

### E.3 `block` — body redacted

- **Steps**: set `mentionResolve='block'`, mention an artifact, ask the LLM
  *"Repeat the title verbatim"*.
- **Expected**: reply says something like *"redacted by provider policy"*
  and does NOT contain the title. In DevTools → Network, the outgoing
  request body shows the mention block body replaced with
  `[redacted by provider policy]`.
- **Record as**: `[E.3] block mode revealed <evidence>`.

---

## F. Token counter

### F.1 Counter visible and live

- **Steps**: type in the composer; add several mentions.
- **Expected**: the composer foot shows `prompt ≈ N tok`. `N` increases in
  real time (debounced ≤200 ms) as text and chips are added.
- **Record as**: `[F.1] counter stale or hidden`.

### F.2 Over-budget styling

- **Steps**: lower `perRequest.maxInputTokens` to 20; type a long message.
- **Expected**: once `N > 20`, the counter turns red (`.text-red-500` or
  equivalent token). Send button shows a disabled/blocked tooltip.
- **Record as**: `[F.2] over-budget counter stayed neutral`.

---

## G. Canvas reverse injection (MP-3)

### G.1 PeakFitArtifactCard row → "Mention in chat"

- **Steps**
  1. Open a peak-fit card in the editor area.
  2. Right-click a table row.
  3. Pick **"Mention in chat"** from the context menu.
- **Expected**: the composer gains a new chip labelled after the peak; the
  textarea's caret position receives `@[label#anchor] `; the composer focuses
  automatically.
- **Record as**: `[G.1] context menu action dropped <expected side effect>`.

### G.2 XrdAnalysisCard PhaseList row

- **Steps**: right-click a phase row in `XrdAnalysisCard` → *"Mention in chat"*.
- **Expected**: identical behaviour to G.1; chip label is the phase name.
- **Record as**: `[G.2] phase mention missing or mislabeled`.

---

## H. InspectorRail Mention button (Stream Y)

### H.1 Button enabled with focused element

- **Steps**: focus a peak (via A.1) → observe InspectorRail header.
- **Expected**: a **"Mention"** button is visible and **enabled**.
- **Record as**: `[H.1] button missing / still disabled with focused element`.

### H.2 Button disabled without focused element

- **Steps**: click outside the peak table so no element is focused.
- **Expected**: the *Mention* button is rendered with `aria-disabled="true"`
  and a tooltip *"Select something in the canvas first."*
- **Record as**: `[H.2] button enabled with no focusedElement`.

### H.3 Click dispatches to composer with toast feedback

- **Steps**: focus a peak → click *Mention*.
- **Expected**: composer receives the chip + token (identical to G.1); a
  `toast.success` appears briefly ("Mentioned Peak 1 in chat").
- **Record as**: `[H.3] button clicked but composer unchanged`.

---

## I. Layout persistence (P1-1)

### I.1 Drag resize persists

- **Steps**: drag the sidebar splitter to 320 px; drag the chat splitter to
  480 px; drag the inspector splitter to 360 px. Reload (`Ctrl+R`).
- **Expected**: all three widths restore to ±1 px of the previous values.
  `localStorage['lattice.prefs']` contains the numeric widths.
- **Record as**: `[I.1] lost width — before/after <sidebar|chat|inspector>`.

### I.2 Toggle visibility persists

- **Steps**: press `Ctrl+B` (sidebar), `Ctrl+L` (chat), `Ctrl+Shift+I`
  (inspector) to hide each. Reload.
- **Expected**: panels remain hidden after reload; pressing the shortcut
  again reveals them at the previously-saved width.
- **Record as**: `[I.2] toggle state not persisted for <panel>`.

---

## J. Accessibility / keyboard

### J.1 SegmentedControl arrow keys

- **Steps**: Tab to the Dialog/Agent SegmentedControl → press `→` then `←`.
- **Expected**: active segment cycles; `aria-selected` moves with the
  highlight; no unexpected focus escape.
- **Record as**: `[J.1] arrow keys on segmented control <observed>`.

### J.2 TaskGroup header Tab + Enter

- **Steps**: Tab to a TaskGroup header; press `Enter`.
- **Expected**: group collapses/expands; `aria-expanded` toggles; focus stays
  on the header.
- **Record as**: `[J.2] TaskGroup not keyboard operable`.

### J.3 StepRow Tab + Enter

- **Steps**: Tab into a StepRow; press `Enter`.
- **Expected**: focus moves to the step's associated artifact in the editor
  (simulating a click); no page scroll jump.
- **Record as**: `[J.3] StepRow did not navigate on Enter`.

---

## Appendix — How to run this as CI (sketch, not in scope)

A pragmatic path is **Playwright + Electron**:

1. Launch the packaged build via `_electron.launch({ args: ['dist-electron/main.mjs'] })`
   so real IPC + PythonManager spawn paths are exercised. Inject a test-only
   env var to make `PythonManager` point at a pre-seeded backend fixture or
   a recorded-response stub.
2. Use `page.evaluate(() => useSessionStore.getState().createSession(...))`
   to seed fixtures deterministically; prefer this over synthetic UI clicks
   for setup so tests stay fast.
3. For each section A–J, re-encode the "Steps / Expected" blocks as a
   `test()` with a visual screenshot assertion (`toHaveScreenshot`). Use
   role-based selectors (`getByRole('textbox')`, `getByRole('button',
   { name: 'Mention' })`) — avoid CSS classes so the tests survive theme
   churn.
4. For IME section B.8 emulate `CompositionEvent` directly via
   `page.dispatchEvent` since Playwright's keyboard doesn't drive IME.
5. Run the token-budget section E against a **mocked LLM provider** injected
   through a URL rewrite so the harness can assert request bodies.

Target < 5 min for the whole suite; parallelise by shard (`A-F` vs `G-J`).
