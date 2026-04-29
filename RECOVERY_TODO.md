# Recovery — modules lost from commit `74a9b81`

The commit `74a9b81 "Add all current work"` referenced 11 source files
that were never staged. Whole-system search (git fsck, reflog, fs find,
project session jsonls) confirmed the originals were unrecoverable.

**Status: rebuilt.** Each file below is a real implementation, not a
stub. Typecheck clean; 362/362 vitest tests pass; electron:dev boots.

If you have the genuine originals on another machine, prefer those
over what was rebuilt here — the rebuilds are interface-true to the
call sites but were not cross-checked against the original source.

## Rebuilt files

| Severity | File | Notes |
| --- | --- | --- |
| **gate** | `electron/ipc-approval-tokens.ts` | Real HMAC-style flow: 32-byte hex token bound to `(toolName, canonicalScope, expiresAt)`, single-use, 60 s TTL, mismatched name/scope deletes the token. Replaces the bypass stub. |
| agent | `src/lib/agent-orchestrator/control.ts` | Real iteration steering: nudge at 2 iterations from cap, force final answer at 1 iteration, soft nudge at ≥24 tool steps. |
| agent | `src/lib/agent-tools/mcp-tools.ts` | Wires through `electronAPI.mcpListTools` / `mcpCallTool`. hostExec; mints approval token before call. |
| agent | `src/lib/agent-tools/plugin-tools.ts` | Same pattern via `pluginListTools` / `pluginCallTool`. |
| agent | `src/lib/agent-tools/workspace-context.ts` | Reads workspace-store + runtime-store; refresh forces `refreshDir`. |
| agent | `src/lib/agent-tools/compute-status.ts` | Reads either compute or compute-experiment artifacts; returns status, exit, progress, stdout/stderr tail, last run. |
| agent | `src/lib/agent-tools/compute-experiment.ts` (+ new `compute-experiment-templates.ts`) | Three create paths: built-in templateId, explicit `points[]`, Cartesian `parameters[]`. Built-in `cp2k_si_bulk_modulus` registered. |
| ui | `src/lib/compute-experiment-runner.ts` | Sequential per-point execution through existing compute IPC. Per-point script substitution (`{{params_json}}`/`{{point_id}}`/`{{point_index}}`/`{{param:<name>}}`). Metric parsing via `__LATTICE_METRIC__ key=value` sentinel. |
| ui | `src/components/canvas/artifacts/ComputeExperimentCard.tsx` | Header (status badge + Run/Stop/Rerun-failed buttons), progress bar, points table with param + metric columns, stdout/stderr disclosure. |
| agent | `src/lib/agent-tools/research-continue-report.ts` | Umbrella tool: dispatches `research_draft_section` for every empty section in order, then `research_refine_report`, then `research_finalize_report`. Resumable. |
| agent | `src/lib/agent-tools/research-refine-report.ts` | Single LLM audit pass (continuity + citation hygiene); non-destructive — writes `qualityAudit` into `payload.assembly` and stamps `stage: 'Refinement'`. |

## Verification

- `npx tsc --noEmit` — clean
- `npm test -- --run` — 362/362 pass (48 files)
- `npm run electron:dev` — boots cleanly

## Known divergences from originals

- `compute-experiment-templates.ts` ships only one built-in template
  (`cp2k_si_bulk_modulus`). The original may have had more. Add new
  ones by appending to `EXPERIMENT_TEMPLATES`.
- `research_refine_report` is non-destructive (only writes to
  `payload.assembly.qualityAudit`). The original may have rewritten
  section markdown; this implementation deliberately doesn't, so
  re-running `research_continue_report` after a partial run does not
  clobber drafted content.
- `compute_experiment_run` is sequential. If the original ran points
  in parallel, parallelism is the most likely place to revisit.
