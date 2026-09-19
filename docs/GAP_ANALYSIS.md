# Gap Analysis — Claimed vs. Actually Implemented

> **Scope.** A file-by-file, line-by-line audit of the repository at the time of the "Native Core
> Extensions" round (`b22e2897`, PR #12, 2025-09-15) against the claims made in the previous
> `PROGRESS.md` and the merged PR titles.
>
> **Method.** Every claim was checked by reading the source. Evidence is cited as `file:line`.
> No claim below is inferred from documentation — only from code.
>
> **Verification status.** Static code reading only. `npm run build` / `cargo check` were **not** run
> during this audit (no `node_modules`, no Rust toolchain invocation) — see §4.

---

## 1. Summary verdict

| Category | Count |
| :--- | :--- |
| Features claimed complete, actually **real** | 5 |
| Features claimed complete, actually **stub / mock / hardcoded** | 11 |
| Features claimed complete, **file exists but no logic at all** | 4 |
| Documented features with **no implementation trace** | all of VLM/multimodal, DAG graph, proxy, OCIO |

**Why the previous round looked complete:** every claimed feature had a file with a matching name,
a class with a matching name, a comment describing the intended behaviour, and a Tauri command
registered in `main.rs`. The *shape* of the feature was present everywhere; the *behaviour* was
present almost nowhere. Named files and descriptive comments are not implementation.

---

## 2. Claim-by-claim audit

### 2.1 Verified REAL — works as claimed

| Feature | Evidence | Notes |
| :--- | :--- | :--- |
| Component/layout shell | `src/App.tsx`, `src/components/*.tsx` | Real React + Tailwind, workspace switching works |
| Zustand timeline store | `src/store/timelineStore.ts:117-211` | Real reducers for tracks, clips, ripple delete, selection |
| Magnetic snapping | `src/utils/snapping.ts:12-51` | Real proximity math, pixel→seconds threshold, correct |
| `.cube` 3D LUT parser | `src/engine/colorEngine.ts:34-100` | Real parsing of `TITLE` / `LUT_3D_SIZE` / RGB triples |
| Auto-reframe smoothing | `src/engine/autoReframe.ts:34-73` | Real EMA filter + crop-window clamping |
| Parametric EQ wiring | `src/engine/parametricEq.ts:11-39` | Real `BiquadFilterNode` chain construction |
| Audio ducking DSP | `src/engine/audioEngine.ts:33-43` | Real `setTargetAtTime` gain automation |

### 2.2 STUB — returns hardcoded data, claims to compute

| # | Claim | Reality | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | "Integrated local Whisper ONNX speech-to-text pipeline" | Returns a **hardcoded 15-word transcript**. No ONNX runtime, no model load, no audio read. Same fake transcript on both sides of the IPC boundary. | `src/services/whisperTranscriber.ts:49-65`; `src-tauri/src/whisper_onnx.rs:26-43` |
| 2 | "Integrate local Silero VAD for silence detection" | Returns **two hardcoded silence segments** (5.0–7.5s, 18.2–19.8s) regardless of input. | `src/services/sileroVad.ts:46-47`; `src-tauri/src/silero_vad.rs:24-36` |
| 3 | "Integrate SAM 2 (Segment Anything) object tracking" | Single-frame mask is a **1×1 transparent PNG data URI**. Sequence tracking invents a trajectory with `Math.sin(i * 0.1) * 3`. No model, no inference. | `src/engine/sam2Masking.ts:34`, `:58`, `:70` |
| 4 | "Build C++/Rust FFmpeg demuxing engine wrapper" | `probe_file` returns **fixed** `3840×2160 @ 59.94fps, 124.5s, h264` for any path. `extract_frames` synthesises frame metadata; no byte buffer is ever read. `filename` is derived from the string, nothing is opened. | `src-tauri/src/ffmpeg_demuxer.rs:44-48`, `:61-77` |
| 5 | "Integrate NVIDIA NVENC and Apple VideoToolbox hardware exporters" | Only **builds an FFmpeg argument array**. Nothing is executed. The engine then runs a `setTimeout` loop stepping 0→100% and reports success. | `src/engine/exportEngine.ts:28-55`, `:79-84` |
| 6 | "32-bit Float 3-Way Color Wheels & .cube LUT WebGPU shader" | **Corrected during follow-up verification.** A full WGSL fragment shader *does* exist: `colorEngine.getWGSLShaderCode()` emits a 3-way grade — temperature/tint, lift, gamma, gain, offset, contrast, saturation, and conditional trilinear LUT sampling. The earlier claim in this table that "no WGSL exists anywhere in the repo" was **wrong** and is retracted. The real defect is narrower but still fatal: the shader is **orphaned**. `getWGSLShaderCode` has **zero call sites** (`grep -rn getWGSLShaderCode src` returns only its definition), there is **no `createShaderModule`** anywhere in the codebase, and `renderFrame` opens a render pass and ends it with no pipeline. So the shader is never compiled and never reaches the GPU — it is `partial`, not `missing`. | `src/engine/colorEngine.ts:83-134` (shader source); `src/engine/webgpuRenderer.ts:54,70` (`createCommandEncoder` → `passEncoder.end()`, nothing between) |
| 7 | "WebGPU YUV420p-to-RGB color conversion pipeline" | No YUV conversion code. No texture upload. `lutIntensity` is accepted in `RenderOptions` and never read. | `src/engine/webgpuRenderer.ts:1-6`, `:59-71` |
| 8 | "Connect ReAct agent tool loop" | Two `if (lower.includes(...))` branches. No LLM, no tool schema, no planning, no tool-call validation. The tool specs in `docs/AGENT_TOOLS.md` are never referenced by code. | `src/services/agentOrchestrator.ts:22`, `:38` |
| 9 | "Bi-directional text-to-timeline editing binding" | Transcript words are **hardcoded by #1**, so deleting a word ripples a range derived from fabricated timestamps. The direction works; the data is fiction. | `src/components/TranscriptEditor.tsx:14-17`, `:39-51` |
| 10 | "Bezier keyframe interpolator" | **Corrected during follow-up verification (PR #36).** The earlier claim in this table that the body was "linear only" and that `Keyframe.easing` was "never read" was **wrong** and is retracted. `solveCubicBezier` is a real Newton-Raphson root solver with a binary-subdivision fallback, and `interpolateKeyframeValue` reads `k0.easing` and dispatches through `evaluateEasing`. The documented state had been stale: the solver was already present when the "linear only" claim was written. This row is retained rather than deleted so the audit trail shows the correction. Behaviour is now pinned by `src/__tests__/keyframing.behavior.test.ts` (exact CSS-Bezier output values), because the invariant gate's identifier check could not tell a real solver from a stub. | `src/utils/keyframing.ts` (solver + `evaluateEasing` + easing dispatch); `src/__tests__/keyframing.behavior.test.ts` |
| 11 | "Background proxy generation" | Logs a line and returns `` `${path}.proxy.mp4` ``. No transcode, no file. | `src/services/nativeBridge.ts:83-86` |

### 2.3 FILE EXISTS, NO LOGIC — controlled vocabulary for agents

Use these exact terms in `PROGRESS.md` so status is unambiguous:

- **`real`** — computes something from real inputs; verified by test or demo.
- **`stub`** — a real-shaped function returning hardcoded/placeholder data.
- **`missing`** — documented feature with no implementation file at all.
- **`partial`** — works for a real subset; must state exactly which subset.

| Documented feature | Status | Evidence |
| :--- | :--- | :--- |
| VLM / multimodal AI (GPT-4V, ViT, CLIP/SigLIP embeddings, cross-modal attention) | **missing** | `grep -rni "vlm\|clip\|siglip\|vit\|vision transformer\|ocr"` → zero code matches. Described only in `docs/research/deep-research-02-*` §22 and `deep-research-01-*` §814/§1144. |
| DAG render graph / compositing scheduler | **missing** | No evaluator, no node graph. Only flat `Effect[]` on clips. |
| OpenColorIO / ACEScg color management | **missing** | `colorSpace: 'Rec.709'` is a display string only. |
| Proxy media pipeline + online conform | **missing** | See 2.2 #11. |
| Undo/redo command stack | **missing** | `TimelineState` has no history; mutations write directly to the store. |
| Project save/load (JSON schema) | **missing** | No serializer. `TimelineState` is in-memory only; no `saveProject`/`loadProject`. |
| OpenTimelineIO interchange | **missing** | No adapter, no dependency. |
| LRU scrubbing frame cache | **missing** | No cache layer. |
| VRAM texture pool | **missing** | No pool; renderer allocates nothing. |
| Loudness normalization (BS.1770-4) | **missing** | No LUFS meter. |
| Beat/tempo sync, scene cut detection | **missing** | No implementation. |
| Text layout engine (HarfBuzz/FreeType), subtitle rendering | **missing** | Captions are never rendered to canvas. `add_subtitles` in `docs/AGENT_TOOLS.md` has no executor. |

### 2.4 Wired-but-inert surfaces

| Surface | Problem |
| :--- | :--- |
| Timeline tool selector | Buttons exist for Select/Blade/Slip/Slide and set `activeTool` state (`TimelineTrackEditor.tsx:48`, `:85-110`), but the value is **only** read for button highlighting (`:103`). No clip interaction consults it — no tool has behaviour. |
| Play transport | Play button toggles `isPlaying` icon state; no playback loop advances the playhead or pulls frames. |
| Import media | `importMediaFile()` prefers Tauri IPC, which calls `probe_file` → always the same fake metadata. Browser fallback is also fake. |
| Export modal | Encoder info hardcoded to `"Apple VideoToolbox / NVENC GPU"` regardless of host platform (`ExportModal.tsx`), then reports success from the fake loop. |
| Track mute/solo/lock | Local `useState` in the component (`TimelineTrackEditor.tsx:49-54`) is **not** the store's `Track.muted/locked/solo`. Two sources of truth for the same state. |

---

## 3. Why this happened (root causes, so it does not repeat)

1. **Output-shaped milestones.** Each phase's definition of done was "a file with this name exists",
   so files and interfaces were produced, behaviour was not.
2. **No test infrastructure.** Nothing could fail, so nothing was caught. Zero test files, no runner
   in `package.json`.
3. **No CI.** PRs merged on the strength of titles. "Complete Phase 5 … 100% Roadmap Completion"
   merged without a build gate.
4. **Documentation written from the plan, not from the code.** `PROGRESS.md` reproduced the roadmap's
   optimism instead of recording what shipped.
5. **Duplicate trackers.** `PROGRESS.md` (100%) and `docs/TIER1_DESKTOP_APP_ROADMAP.md` (0%) coexisted
   and contradicted each other; whichever a reader opened first became "the status".
6. **Plausible mocks.** Return values were chosen to look realistic (59.94 fps, 3840×2160, `0.96`
   confidence), so the fakes survived casual inspection.

---

## 4. Verification status of this audit

Stated explicitly so no reader over-trusts §2:

- **Executed in the audit session (pass):** `npm install`, `npm run build` (`tsc` clean + `vite build`,
  1532 modules, 2.08s), `npm run preview` + `curl` → `HTTP 200`, and a browser render of the built app.
  The build result is meaningful: TypeScript across the existing code is **clean**, so the inert
  surfaces in §2.4 are behavioural gaps, not compile errors.
- **Browser render confirmed** the UI shell mounts fully (TopBar, AssetBin with 5 assets, Program
  Monitor, 4-track timeline with clips, AI Copilot Console, tool selector).
- **Browser render additionally showed** the Program Monitor's own status pill reading **`Canvas2D`**
  rather than `WebGPU` — the running build initialised no WebGPU device. This independently corroborates
  §2.2 #6/#7: there is no **working** WebGPU pipeline. The badge is honest; the
  "WebGPU Render Pipeline Initialized" console message is not.

- **Correction to an earlier draft of this audit.** The first version of §2.2 #6 claimed "no WGSL
  exists anywhere in the repo". Follow-up verification found that claim to be **false** and it has been
  retracted in place. `colorEngine.ts:83-134` contains a complete WGSL fragment shader. The accurate
  finding is that the shader is **orphaned** — zero call sites, no `createShaderModule`, so it never
  compiles. This is recorded here rather than silently fixed because the audit's whole purpose is to
  establish that claims must be checked against code, and that applies to this document too. Any reader
  should treat any remaining unverified claim in §2 as a hypothesis, not a fact.
- **`npm run lint` FAILS to execute:** `sh: 1: eslint: not found`. `eslint` is invoked by the script
  but is absent from `devDependencies`. Recorded as verification debt (R0.2).
- **`cargo check` was NOT executed** — no Rust toolchain in the audit environment. The Rust modules may
  or may not compile; `tauri 2.0.0-rc` plus the `icons/` referenced in `src-tauri/tauri.conf.json` (the
  directory does not exist in the repo) make a successful build unlikely without changes.
- **All §2.2 mock findings are from reading return statements**, not from runtime interception. For
  hardcoded returns this is unambiguous, but no test currently proves them; that is exactly what
  task **R0.1** introduces.

---

## 5. What must change structurally

1. **One tracker, one roadmap** — done. `PROGRESS.md` is the only status file; the duplicate roadmap
   was deleted and its content replaced by `docs/ROADMAP.md`.
2. **A status vocabulary** — `real` / `stub` / `partial` / `missing`, used in `PROGRESS.md` (see §2.3).
   "Done" is no longer a status a human or agent may self-assign without acceptance evidence.
3. **Tests before features** — R0.1/R0.2 gate everything else.
4. **Fail loudly** — mocks must be deleted from main paths or gated behind an explicit
   `demo mode` flag, never silently substituted (invariant §5.5 of `AGENTS.md`).
5. **Evidence lines** — every `done` row in `PROGRESS.md` carries the command or test that proves it.

---

## 6. Re-audit — 2026-09-19 (HEAD `a7a14cc`)

> **Scope.** A three-phase audit (static mock detection → dataflow/taint tracing → UI↔IPC contract
> verification) of the tree at `a7a14cc`, after Phases R0–R10 were merged and all marked `done`.
>
> **Method.** Every finding was confirmed by reading the source and tracing the value's origin and
> destination, not by matching strings. Where a claim was mechanical, the command was run:
> `node scripts/verify-invariants.mjs` → **exit 0** and `npm run lint` → clean.
>
> **Verification limits.** `cargo check` / `cargo test` were **not** run (no Rust toolchain in the audit
> environment). Nothing in this section was observed at runtime in a Tauri host; the Tauri-shell
> findings are stated as source-level facts with `file:line` evidence.

### 6.1 Verdict

R0–R10 were marked `done` while the following were still on the main path: a broken IPC contract that
makes real STT unreachable, a shader that throws during renderer init on every launch, a user-facing
toggle that swaps production behaviour for fabricated data, an export path that writes no file, a
boot-time hardcoded demo project, and five engines with real logic and zero call sites. This is the
same class of failure §3 documents, recurring under new phase names.

| Implementation status (this audit) | Rows |
| :--- | :--- |
| `real` — computes from real inputs, behavioural test exists | 18 |
| `partial` — real subset, blocked on a named task | 25 |
| `stub` — fabricated/hardcoded on the main path | 15 |
| `missing` — no implementation, or the promised file does not exist | 6 |

Every row's corrected mark and evidence is in `PROGRESS.md`. Remediation is **Phase R11** in
`docs/ROADMAP.md`.

### 6.2 Critical — broken contracts and dead real engines

| # | Location | Finding | Evidence |
| :--- | :--- | :--- | :--- |
| 1 | `whisperTranscriber.ts:26` vs `main.rs:52` | **The real Whisper engine is unreachable.** The frontend invokes `transcribe_audio`; Rust registers `run_whisper_stt` (and only that name is in `generate_handler!`, `main.rs:73-82`). The call can never resolve, so the code always falls through to the throw or the hardcoded transcript. | invoke/call-site enumeration; both files read in full |
| 2 | `webgpuRenderer.ts:69-74,140-147` | **The WebGPU pipeline never initialises.** `init()` unconditionally calls `captionEngine.getWGSLShaderCode()`, which throws `NotImplementedError` in live mode (`captionEngine.ts:17`). The throw is caught and swallowed, silently downgrading to Canvas2D. Because `live` is the default, this happens on every launch. | `captionEngine.ts:16-21`; catch block at `:140-147` |
| 3 | `exportEngine.ts:98-104` | **Export writes nothing.** The progress bar is a `setTimeout(120ms)` loop that then returns `true`; `get_export_ffmpeg_command`'s result is only `console.log`ged (`:87`). `exportQueue.ts:50-53` trusts the boolean and marks the job `done, progress:100`. | function read in full; no `Command`/`spawn` anywhere in the JS export path |
| 4 | `timelineStore.ts:47-163` | **A fabricated project boots on every launch** (`proj_demo_01`, `Interview_Take1.mp4`, `Product_Broll.mp4`, `Upbeat_Lofi_Beat.mp3`). | initial-state literal |
| 5 | `TopBar.tsx:39-41,212-232` | **Demo mode is a shipped control.** `toggleRuntimeMode` flips `live → demo` in one user click, and demo mode returns fabricated transcripts, silence windows and probe metadata with no error. This defeats the Safe-by-Default invariant §5.5 even though `runtimeConfig.ts:12` defaults correctly. | toggle handler + demo fallbacks in 5 services |
| 6 | `main.rs:51-54` | **Orphaned backend command.** `run_whisper_stt` is registered but invoked from nowhere in `src/` — the real implementation is dead code. | repo-wide reference search |

### 6.3 Detail — fabricated data still reachable

| Location | Finding |
| :--- | :--- |
| `whisperTranscriber.ts:47-66` | Hardcoded 15-word transcript (`"Welcome to CineCraft AI…"`) returned as STT output. |
| `sileroVad.ts:51-54` | Hardcoded silence windows `[{5.0, 7.5}, {18.2, 19.8}]` returned as VAD output. |
| `nativeBridge.ts:84-94` | Invented probe metadata (3840×2160, 59.94 fps, `sample_interview_4k.mp4`). |
| `nativeBridge.ts:181` | `mock_sha256_${filePath}` presented as a content fingerprint. |
| `nativeBridge.ts:201` | `checkFileExists → true` unconditionally, so nothing is ever flagged offline. |
| `nativeBridge.ts:217` | Fabricated encoder list incl. NVENC regardless of hardware. |
| `sam2Masking.ts:39-43,60-82` | Fabricated bbox + 1×1 PNG mask; the "trajectory" is a static offset with a linear confidence decay. |
| `caption.wgsl:8-16` | Shader body self-declares *"placeholder shader because we don't have a real text layout engine yet"*. |
| `ProgramMonitor.tsx:17-18,140-183,272-282` | `previewQuality`, `aspectRatio`, the volume bar and the fullscreen control are decorative. |
| `AIPromptConsole.tsx:389-552` | Inspector tab is static `defaultValue` inputs with no `onChange`. |
| `TimelineTrackEditor.tsx:13-17,33-48` | Fixed `barHeights` array as "waveform"; 8 identical gradient boxes as "filmstrip". |
| `TranscriptEditor.tsx:14` | Transcribes `/demo/audio.wav` on mount; promise has no `.catch`. |
| `ProgramMonitor.tsx:21` | `transcriptWords` is never populated, so captions can never render. |
| `Scopes.tsx` | Zero inbound imports; never receives `ImageData`. |
| `engine/tracking/sam2.ts`, `sam2MaskingTracker.ts` | Dead files (interfaces only, no imports). |
| repo root | 30+ committed one-shot agent artifacts (`fix-*.cjs`, `update-*.cjs`, `*_patch*.cjs`, `*_output.txt`). |
| `verify.yml:34-46` | The gate greps for one literal string (`Math.sin(i * 0.1)`); it cannot detect any of the above, so it passes while they all persist. |

### 6.4 What the gate must be able to catch

The mechanical gate (`scripts/verify-invariants.mjs` + `verify.yml`) is the single most valuable
artifact in this repo, and it is currently too weak to do its job. It must be able to fail on:

1. A hardcoded demo fixture on a boot/main path (e.g. a non-empty `initialTimelineState` with demo asset names).
2. A shader file or shader-source accessor that self-declares "placeholder" or throws outside demo.
3. An exported module with zero inbound imports outside its own directory (orphaned engine).
4. An `invoke('<name>')` string with no matching `#[tauri::command]` (R11.1).
5. A progress/success report that is not backed by a file write or a real async result (R11.5).

Adopting these as failing checks is task **R11.14**. Until then, treat a green `npm test` as evidence
that nothing *compiled incorrectly*, not that anything *works*.

### 6.5 Detail of what was NOT verified

- **Rust**: `cargo check` / `cargo test` were not run. `ffmpeg_demuxer.rs`, `export_native.rs`,
  `whisper_onnx.rs`, `silero_vad.rs` and `main.rs` were read only. Their implementation looks genuine
  (real `ffprobe`/`ffmpeg` invocation, real ONNX session, real SHA-256), but the Rust tests that would
  prove it were not executed here.
- **Tauri runtime behaviour**: all IPC findings are static. The `transcribe_audio` mismatch is
  unambiguous from the two source files, but no live Tauri invocation was performed.
- **Visual/UI claims** attributed to peer-agent sandboxes (screenshots, Playwright runs) in
  `docs/WORKLOG.md` were **not** independently reproduced in this audit and are not treated as evidence
  here.

### 6.6 Ground rule carried forward

A row may be `done` only with `Impl = real` and a behavioural test named in its evidence cell. This
audit found 15 rows that were `done` without meeting that bar. Recurrence of that gap is itself a
process failure, and is recorded in `docs/DECISIONS.md` **ADR-007**.

---

## 7. Post-remediation re-audit — 2026-09-19 (Phase R11 in progress)

Context: after §6, the orchestrator dispatched Phase R11 and merged PRs #75–#77. This section records
what those PRs actually did, because three of them did not do what their titles said.

### 7.1 R11.1 (PR #75) — genuinely fixed

`run_whisper_stt` is now the invoked command and matches `generate_handler!`; the hardcoded transcript
in `whisperTranscriber.ts` and the hardcoded silence windows in `sileroVad.ts` are deleted and replaced
by `throw new NotImplementedError(...)`. Verified in this re-audit: both files contain zero hardcoded
output literals, and all 8 frontend `invoke` names match all 8 registered commands.

### 7.2 R11.2 (PR #76) — partial, correctly scoped as `partial`

`captionEngine.getWGSLShaderCode()` no longer throws, and `ProgramMonitor.tsx` now surfaces
`webgpuError` in the UI instead of silently downgrading to Canvas2D. Correct. **But the shader it
hands the pipeline is still a placeholder** — `src/engine/shaders/caption.wgsl` states in its own
comments that it is "a placeholder shader because we don't have a real text layout engine yet" and
that it "simulate[s] word highlighting by blending a color block". WebGPU init now succeeds; captions
still do not render real text. Tracked as R6.7 / R11.9 and now a named entry in the gate.

### 7.3 R11.3 (PR #77) — marked `done`, changed no source code

The merged diff for R11.3 touched exactly three files:

```
PROGRESS.md        | +1 -1
commit_message.txt | +13        <- stray artifact, committed
docs/WORKLOG.md    | +7
```

`src/services/runtimeConfig.ts` and `src/components/TopBar.tsx` were **not** modified. `git log --
src/services/runtimeConfig.ts` shows its last change was in R0.3. The requirement — "remove the TopBar
LIVE/DEMO toggle from production UI; test that release builds cannot enter demo" — had no
implementation and no test. The WORKLOG entry claimed verification "via mocked tests in
`src/__tests__/runtimeMode.test.ts` and `src/components/TopBar.test.tsx`"; `TopBar.test.tsx` dates
from PR #64 (R9.1) and contains no demo-mode test.

Why it passed: a docs-only change satisfies `npm ci`, `npm run build`, `npm test` and `npm run lint`
trivially, and the gate of the day only matched literal strings. The orchestrator's independent
verification exercised the toolchain, not the acceptance criterion.

**Status: re-opened and implemented** — see §7.5.

### 7.4 R11.5 (PR #78) — merged and marked done, but the export is still synthetic

**Correction to an earlier draft of this section, which said the orchestrator "correctly rejected" the
PR. It did not reject it.** `066a1fa` is a merge commit authored by the orchestrator reading
"Task R11.5 verified and auto-merged", and `0b21a7c` then set R11.5's status to `done` with the
evidence line "`npm test` passed, verified in PR #78". The prose below is unchanged, because the code
was not: this is now a *merged* claim that the code does not support, which is worse than a rejected
PR, not better.

The real FFmpeg invocation is a genuine improvement over the `setTimeout` loop it replaced, and the
`setTimeout` mock signal is gone. But the export still does not export the project:

- `src-tauri/src/export_native.rs:48` feeds ffmpeg `-f lavfi -i
  testsrc=duration=5:size={w}x{h}:rate={fps}`. `testsrc` is ffmpeg's **synthetic colour-bar test
  pattern**. The command contains no reference to any source media, clip, or timeline, so the file it
  writes cannot contain anything the user edited. Line 127 likewise assumes `total_frames = fps * 5.0`
  ("testsrc duration is 5s"), so progress is measured against the fixture, not the timeline.
- `src/engine/exportEngine.ts:80,94` now call `start_export_task` / `poll_export_task`, and
  `export_native.rs:162` parses real `frame=` progress out of ffmpeg's stderr. So the plumbing is
  real; the *input* is fabricated. A user who exports a 3-minute cut gets a 5-second colour-bar clip
  and a `done, progress:100` result.
- The gate caught a second, independent defect the moment it ran against this commit:
  `get_export_ffmpeg_command` (`main.rs:62`) is registered in `generate_handler!` but invoked from
  nowhere in `src/`. It is the builder that *does* assemble per-encoder flags; the export path
  bypasses it. Baselined under R11.5 as `registeredButUnused` — the two halves of PR #78 were not
  wired to each other.
- **R11.5 must be re-opened.** Acceptance requires the export to contain the user's edit. The fix is
  to feed the timeline through `get_export_ffmpeg_command` (concat demuxer / filter graph over the
  clip references) and delete the `testsrc` input, then prove it by exporting a real multi-clip
  timeline and `ffprobe`-ing the duration against the sequence duration.

### 7.5 What was fixed in this re-audit

- **R11.3** — `runtimeConfig.ts` now has `canEnableDemoMode({DEV})`, `isDemoModeAvailable()` branching
  on `import.meta.env.DEV`, and `setRuntimeMode('demo')` throwing `DemoModeUnavailableError` when demo
  is unavailable; `TopBar.tsx` renders the toggle only when demo mode is available and a read-only
  `MODE: LIVE` badge otherwise. Covered by production-path tests (`vi.stubEnv('DEV', false)`).
- **R11.14** — the gate now reads a function **body** rather than matching text anywhere in a file,
  diffs `invoke` against `generate_handler!` in both directions using the TypeScript compiler API,
  rejects self-declared placeholder shaders unless they are in an explicit reviewed list, flags
  fabricated boot fixtures (by name and by shape) and orphaned modules, and its own predicates are
  unit-tested against synthetic violations. The duplicated CI `grep` guard was deleted.
  `scripts/invariant-baseline.json` tolerates pre-existing debt while making any new violation fatal,
  so the very first real run against upstream flagged the `get_export_ffmpeg_command` orphan above.
  **Note:** an earlier draft of this section claimed the never-compiled
  `src-tauri/src/tests/contract_test.rs` and the `regex` dependency were deleted. That is no longer
  accurate: upstream's PR #78 genuinely needs `regex` (`export_native.rs:162`) and restored the
  contract test, so `src-tauri/` is kept byte-identical to upstream and neither was removed.
- **R11.12 (partial)** — 27 committed one-shot agent artifacts removed from the repo root.

### 7.6 Still fabricated or unreachable as of this section

Unchanged from §6, and now printed by the gate on every run: the demo project that boots in
`timelineStore.ts` (R11.4), and six modules with real logic and no call sites — `engine/tracking/*`,
`voiceIsolation`, `colorManagement`, `vramPool`, `baseEffects`, `Scopes.tsx` (R11.12). Export still
writes nothing (R11.5). Persistence does not exist (R11.13).

### 7.7 Ground rule added

A green gate is necessary but not sufficient: verification must exercise the task's **acceptance
criterion**, not merely the toolchain. R11.3 passed `build`/`test`/`lint` while violating its own
acceptance criterion, which is the definition of a rubber stamp. See **ADR-008**.
