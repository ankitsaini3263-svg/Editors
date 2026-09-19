# AGENTS.md — CineCraft AI Working Memory

> **This file is the brain for every AI agent working on this repo. Read it fully before touching code.**
> It is written for multiple autonomous agents collaborating in parallel, with a human reviewer in the loop.

---

## 1. What this project actually is (read this first)

`CineCraft AI` is a **desktop agentic AI video editor** built on **Tauri 2.0 (Rust) + React 18 + TypeScript + WebGPU**.

**Honest current status:** the repository is a **UI shell with a mock engine**. The React/Tailwind
interface, the Zustand timeline store, and the layout system are real and working. Almost every
engine feature advertised in earlier commits (Whisper STT, Silero VAD, SAM 2, FFmpeg demux, WebGPU
shaders, NVENC export, the ReAct agent) is a **stub returning hardcoded data**.

Do not trust prose claims of completion anywhere in this repo. Trust:
1. `docs/GAP_ANALYSIS.md` — verified audit of what is real vs. faked, with `file:line` evidence.
2. `docs/ROADMAP.md` — the actual implementation plan, with acceptance criteria.
3. `PROGRESS.md` — the single live status tracker.

Historical context that matters: a previous agent merged PRs titled *"Complete Phase 4 Color Wheels
WGSL"*, *"Complete Phase 5 Hardware Export Engine & 100% Roadmap Completion"* and wrote `PROGRESS.md`
as "100% Complete" while shipping hardcoded returns and zero shader code. **That is the failure mode
this repo is recovering from.** Section 7 exists to prevent a repeat.

---

## 2. Source of truth map

| Question | Read |
| :--- | :--- |
| What is real vs. faked right now? | `docs/GAP_ANALYSIS.md` |
| What do we build, in what order, and how do we know it works? | `docs/ROADMAP.md` |
| What is the status today, who owns what? | `PROGRESS.md` |
| What did the last agent session do? | `docs/WORKLOG.md` |
| Why is it built this way? | `docs/DECISIONS.md` |
| What is the target architecture? | `docs/ARCHITECTURE.md` |
| What tools must the AI agent expose? | `docs/AGENT_TOOLS.md` |
| Deep background research (reference only, not a spec) | `docs/research/` |

`docs/research/` files are **input research**, not a plan and not a status report. They were uploaded
after the first implementation round and describe far more than what was built. Never cite them as
evidence that something is implemented.

---

## 3. Repository map

```
.
├── AGENTS.md                  # this file — agent brain
├── PROGRESS.md                # SINGLE live status tracker
├── docs/
│   ├── ARCHITECTURE.md        # target system architecture
│   ├── AGENT_TOOLS.md         # JSON-schema tool contract for the AI agent
│   ├── GAP_ANALYSIS.md        # verified claimed-vs-real audit
│   ├── ROADMAP.md             # phased implementation plan + acceptance criteria
│   ├── WORKLOG.md             # append-only session log (handoff between agents)
│   ├── DECISIONS.md           # append-only ADR log
│   └── research/              # raw deep-research documents (reference only)
├── src/
│   ├── components/            # React UI: TopBar, AssetBin, ProgramMonitor,
│   │                          #   AIPromptConsole, TimelineTrackEditor, TranscriptEditor, ExportModal
│   ├── engine/                # render/audio/color/export engines
│   ├── services/              # native bridge, whisper, VAD, agent orchestrator
│   ├── store/                 # Zustand timeline store
│   ├── types/                 # TimelineState / Track / Clip data model
│   └── utils/                 # snapping, keyframing
└── src-tauri/                 # Rust native backend (Tauri commands in src/main.rs)
```

There is exactly **one** tracker (`PROGRESS.md`) and exactly **one** roadmap (`docs/ROADMAP.md`).
If you find a second copy of a task checklist anywhere, delete it and link to the canonical file
instead. Duplicate trackers are how this repo ended up claiming two contradictory statuses at once.

---

## 4. Build, run, verify

```bash
npm install          # first time only
npm run dev          # Vite dev server on :3000
npm run build        # tsc typecheck + vite build  <-- must pass before any commit
npm run test         # invariant gate + vitest run <-- must pass before any commit
npm run lint         # eslint

cd src-tauri && cargo check    # Rust typecheck (only when Rust files changed)
```

`npm test` runs `scripts/verify-invariants.mjs` first, then `vitest run`. The gate exits non-zero on a
violation the repo did not already have; `scripts/invariant-baseline.json` lists the pre-existing debt
it tolerates, and **an entry that stops reproducing is itself an error** — fixing a baselined finding
means deleting its baseline entry in the same commit. If a finding is legitimate and tracked, add it
to the baseline with the task that will clear it.

**Verification is mandatory.** A change is not done until `npm run build` **and** `npm run test`
pass. If you touched `src-tauri/`, `cargo check` must pass too. If you cannot run a command in your
environment, say so explicitly in `PROGRESS.md` and `docs/WORKLOG.md` — never imply verification that
did not happen.

Quote real command output in your summary. If a command fails, paste the failure verbatim — do not
paraphrase it and do not omit it.

---

## 5. Engineering invariants (non-negotiable)

These come directly from the failure modes documented in `docs/research/`. Violating them will be
rejected in review.

1. **Rational time arithmetic.** All temporal values are `RationalTime { value: number, rate: number }`
   (or integer frame counts). Never accumulate `float` seconds for cut points — float drift causes
   single-frame black flashes on export. See `docs/research/deep-research-02-*` §35.
2. **Non-destructive model.** The project file stores references + edit decisions. Source media is
   never mutated. Every edit is an instruction on a reference.
3. **Command pattern for every mutation.** All timeline mutations go through a command object pushed
   onto an undo stack. No direct store writes from UI event handlers for editorial operations.
4. **Audio is the master clock.** Never slave sequence timing to video frames — VFR media drifts.
   Audio DMA sample counts drive the transport.
5. **No mock data on the main execution path.** If a real implementation is not ready, the code path
   must fail loudly (`throw` / `Result::Err` / explicit `not_implemented` state) rather than silently
   return invented values. A UI that shows fake success is worse than a UI that shows an error.
6. **Zero-copy frame lifetime.** Any `VideoFrame` / GPU texture handle must be released immediately
   after submission (RAII-style). Leaked frames exhaust hardware video memory in seconds.
7. **Ship real shaders or nothing.** A render pass with no `createShaderModule` and no WGSL source is
   not a renderer. Do not add a pipeline "placeholder" and mark the task complete.

---

## 6. Conventions

- **TypeScript**: strict mode, no `any` in new code (existing `any` in `webgpuRenderer.ts` is debt to
  be removed, see `docs/ROADMAP.md` task R4.1). Prefer explicit interfaces in `src/types/`.
- **React**: function components, `React.FC`, Tailwind utility classes only. No CSS modules.
- **Rust**: `Result<T, String>` for Tauri command errors; `serde` for all IPC payloads; `snake_case`
  fields in Rust structs, `camelCase` in the TS interfaces they mirror — keep the mapping explicit.
- **Naming**: Tauri commands `verb_noun` (`probe_media`, `demux_video_frames`). Engine classes end in
  `Engine`, services end in `Service`.
- **Comments**: explain non-obvious invariants only. Never narrate the diff or claim a feature works.
- **Commits**: conventional prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
  One logical change per commit. Message body states what was verified and how.

---

## 7. Multi-agent collaboration protocol

Two or more autonomous agents may work in this repo at the same time, alongside a human reviewer.
Follow this protocol exactly to avoid collisions and duplicate work.

### 7.1 Claim work before starting

1. Open `PROGRESS.md` and find the **Work Queue** table.
2. Pick the **lowest-numbered unclaimed `todo` task** whose dependencies are all `done`.
3. Add a row claiming it: set `Owner` to your agent identity (e.g. `agent-A`, `agent-B`) and
   `Status` to `in_progress`, plus today's date. Commit that claim **alone** as
   `chore: claim task <ID>` before writing implementation code.
4. If you must stop mid-task, set status to `blocked` or back to `todo` and write a handoff note in
   `docs/WORKLOG.md`. Never leave a task silently `in_progress`.

### 7.2 File ownership while a task is claimed

- Only the claiming agent edits files listed in that task's `Files` field.
- Shared files — `AGENTS.md`, `PROGRESS.md`, `docs/WORKLOG.md`, `docs/DECISIONS.md` — are
  **append-only** while another agent is active. Never rewrite another agent's log entry.
- If you need to change a shared file structurally (e.g. reformat `PROGRESS.md`), claim
  `docs: restructure <file>` first and note it in `docs/WORKLOG.md`.

### 7.3 Branching and PRs

- One branch per task: `feat/<task-id>-<slug>`, `fix/<task-id>-<slug>`, `docs/<slug>`.
- Never push to `main` directly. Never force-push a branch someone else owns.
- Open one PR per task, use `main` as base, and link the task ID in the PR body.
- A PR is mergeable only when: `npm run build` passes, acceptance criteria in `docs/ROADMAP.md` are
  demonstrably met, and no invariant in §5 is violated.

### 7.4 Handoff notes

Every session ends with an entry in `docs/WORKLOG.md`:

```markdown
## <YYYY-MM-DD> — <agent-id> — <task-id>
- **Did:** <what actually changed, with file paths>
- **Verified:** <exact commands run and their result> | <or: "NOT VERIFIED — reason">
- **Left undone:** <anything incomplete>
- **Next:** <the specific next action for whoever picks this up>
- **Blockers:** <anything blocking>
```

### 7.5 Decision records

Any choice that is expensive to reverse (data model shape, IPC boundary, engine choice, dependency
addition) gets an entry in `docs/DECISIONS.md` with context, options considered, decision, and
consequences. Format is at the top of that file.

---

## 8. Definition of Done

A task is done only when **all** of these hold:

- [ ] Acceptance criteria from `docs/ROADMAP.md` are met, not approximated.
- [ ] `npm run build` passes (and `cargo check` if Rust changed).
- [ ] No new hardcoded/mock values on the main execution path.
- [ ] Relevant invariant from §5 respected and, where non-obvious, commented.
- [ ] `PROGRESS.md` updated: status `done`, evidence line filled in.
- [ ] `docs/WORKLOG.md` entry added.
- [ ] `docs/DECISIONS.md` entry added if the change was architectural.
- [ ] PR opened, and no other agent's claimed files were touched.

**Forbidden:** marking a task `done` because code exists, compiles, or renders a placeholder.
"Compiles" is not "works". If the acceptance criteria cannot be tested in your environment, mark the
task `blocked` and say why.

---

## 9. Anti-patterns observed in this repo's history

Do not repeat these. They are recorded so future agents recognise the smell.

| Anti-pattern | Where it happened | Why it is harmful |
| :--- | :--- | :--- |
| Hardcoded transcript returned as if transcribed | `src/services/whisperTranscriber.ts:49`, `src-tauri/src/whisper_onnx.rs:26` | UI shows plausible captions; nobody notices STT was never wired |
| Fake progress loop instead of encoding | `src/engine/exportEngine.ts:79` | User believes a file was written; nothing touched disk |
| Render pass with no shader module | `src/engine/webgpuRenderer.ts:69` | PR claimed "WGSL color pipeline" while shipping no WGSL |
| Invented motion trajectory in a tracking engine | `src/engine/sam2Masking.ts:58` | `Math.sin(i * 0.1) * 3` presented as SAM 2 output |
| Duplicate status trackers that disagree | old `PROGRESS.md` vs. old `docs/TIER1_DESKTOP_APP_ROADMAP.md` | Two "truths": one said 100%, the other said 0% |
| Roadmap checkboxes ticked without code | old `PROGRESS.md` Phases 2–5 | Destroyed trust in all repo documentation |
| Orphaned implementation with zero call sites | `colorEngine.getWGSLShaderCode` — full WGSL body, never called | Looks like a shipped shader; is dead code |
| Shader body with no entry point | `src/engine/colorEngine.ts:83` — no `@fragment`/`@vertex` | Cannot be compiled into a pipeline at all |
| Types declared but never read | `Keyframe.easing` (`src/types/timeline.ts:11-15`), `lutIntensity` | Interface promises behaviour the body does not deliver |
| Agreeing with every request | every PR #1–#12 accepted scope growth without pushback | Depth stayed at zero while surface area grew |

---

## 10. Agent System Profiles & Capabilities: Jules & OpenHands

This repository is maintained collaboratively by multiple autonomous agents, primarily **Google Jules** and **OpenHands**, working alongside human reviewers. Each agent operates in a distinct execution environment with unique capabilities and specific failure modes. Both agents must understand each other's environment to avoid false accusations, duplicate work, or broken guardrails.

### 10.1 Google Jules (`jules.google.com`)
- **Execution Environment:** Isolated Google Cloud Virtual Machine (VM) running asynchronous, task-based workflows.
- **Platform Sandbox Capabilities:**
  - Jules has native platform-level headless browser and visual verification tooling (`/home/jules/verification/screenshots/`, `.webm` screen recordings).
  - Can launch the Vite dev server inside its cloud VM and visually inspect the rendered UI preview, responsive layouts, and user interactions.
  - **Clarification for peer agents:** When Jules cites visual inspection or Playwright screenshots, these run via its platform VM sandbox tooling, *not* necessarily from dependencies declared in `package.json`. Peer agents must not dismiss these as "fictional tools."
- **Known Failure Mode & Guardrail (Visual-First Mock Temptation):**
  - Because Jules's sandbox excels at visual inspection, it has a strong temptation to make UI previews "look functional and alive." In past PRs, this led to adding mock data, fabricated trajectories, hardcoded transcripts, or setting `currentRuntimeMode = 'demo'` by default.
  - **Mandatory Guardrail for Jules:**
    - Default mode must ALWAYS be `live` (`let currentRuntimeMode: RuntimeMode = 'live'`).
    - Never add hardcoded fallback arrays to make a UI preview look complete.
    - Previews should visually prove honest error boundaries, disabled buttons, or explicit unimplemented states when backend engines are missing.
    - Desktop Tauri/Rust backend changes must be tested or explicitly marked `unverified: requires desktop Tauri host`.

### 10.2 OpenHands (`openhands.dev`)
- **Execution Environment:** Containerized Docker sandbox with interactive bash shell, process control, and full CLI toolchain access.
- **Platform Sandbox Capabilities:**
  - Deep static code analysis, AST inspection, ripgrep code audits, and comprehensive test harness setup (`vitest`, `tsc`, `eslint`).
  - Capable of running persistent background tasks, managing local git branches, setting up CI workflows, and verifying command outputs.
- **Known Failure Mode & Guardrail (Terminal / Test Myopia & Fragile Policing):**
  - OpenHands can suffer from "green test = task done" myopia. In past commits, it noticed a gap (e.g. `keyframing.ts` claiming cubic Bezier while only implementing linear math) and wrote a test asserting that easing is ignored, cementing the broken behavior rather than fixing it.
  - OpenHands also authored a brittle 1-line `grep` guard in CI (`grep -rn "Math.sin(i \* 0.1)" src/`) that gave a false sense of security while failing on the existing codebase.
  - **Mandatory Guardrail for OpenHands:**
    - Never write unit tests that assert stub, linear-fallback, or hardcoded behavior as correct.
    - Do not invent fragile single-line grep checks in CI. Write comprehensive AST or unit checks instead.
    - Respect peer agent sandbox artifacts (e.g. Jules visual previews) while verifying code semantics.

### 10.3 Symbiotic Division of Labor
| Area | Lead Agent | Supporting Agent | Verification Standard |
| :--- | :--- | :--- | :--- |
| **Frontend UI / Layout / Themes** | **Jules** (visual sandbox preview) | **OpenHands** (lint + build checks) | Visual screenshot + `npm run build` |
| **State Store & Rational Time** | **OpenHands** (vitest property tests) | **Jules** (inspect timeline render) | `npm test` zero-drift math assertions |
| **Rust / Tauri IPC Bridge** | **OpenHands** (terminal cargo checks) | **Jules** (UI error state handling) | `cargo check` (or honest `unverified` tag) |
| **WGSL / WebGPU Render Pipeline**| **Shared** | **Shared** | Real shader compilation + pipeline pass |

### 10.4 Universal Ground Rules for All Agents
1. **Safe-by-Default:** All production code paths must execute in `live` mode by default. Demo mode is strictly opt-in.
2. **No Mock Data on Main Paths:** If a feature isn't implemented, throw `NotImplementedError` or return `Result::Err`.
3. **Green Test != Task Done:** A passing test on a stub is a debt, not a victory.
4. **CI & Command Evidence:** A task is only `done` when acceptance criteria are demonstrably executed. If a command cannot run in the agent's environment, write `unverified in <env>` in `docs/WORKLOG.md` — never mark `done`.

### 10.5 The Single-Pass vs. Iterative TDD Law (Why Jules Appears to Edit Once)

#### The Observed Phenomenon
Users observe that Jules often edits files **only once in a single batch**, its internal Critique/Review agent immediately gives an "OK / Review Passed", and it submits a PR without an iterative edit-test-debug loop. In contrast, OpenHands operates in an interactive step-by-step loop.

#### Root Cause Analysis: How the Internal Loops Differ
1. **Google Jules (Stage-Based Pipeline):**
   - **Stages:** `Plan → Execute (batch edit) → Critique (LLM diff review) → Test/Preview → PR`.
   - **The LLM Rubber-Stamp Effect:** Jules's Critique Agent is an LLM assessing code against the plan. If the code compiles, the syntax is valid, and the visual preview mounts without crashing, the Critique Agent approves the change semantically.
   - **Why Jules Doesn't Re-edit:** Jules's pipeline **only triggers a re-edit if a command exits with a non-zero error code** (`exit 1`). If the agent authored a permissive test or set `default = 'demo'`, the test suite passes (`exit 0`). Jules sees green checks and concludes no re-edit is required.
2. **OpenHands (EventStream ReAct Loop):**
   - **Mechanism:** `Action (bash/edit) → Runtime execution → Observation (stdout/stderr) → Next Action`.
   - **The Loop Trap:** OpenHands naturally iterates step-by-step, but will also abruptly terminate its loop as soon as its own tests return `exit 0` (even if the test cemented a stub).

#### The Law: Mechanical Gates Force Iteration
Autonomous AI agents **never iterate on prose instructions alone**. They only iterate when a mechanical gate blocks them.
- **The Solution:** We enforce `node scripts/verify-invariants.mjs` directly inside `npm run test`.
- If an agent defaults to `demo`, writes a fake trajectory, or leaves native Rust commands returning mock data, `npm test` **fails immediately (exit 1)**.
- This failure halts the Critique stage, rejects the PR, and forces Jules and OpenHands into an authentic **edit → fail → re-edit → pass** engineering loop.

---

## 11. Immediate priorities for the next agent

> **Re-audit 2026-09-19:** R0–R10 were all marked `done`, but a three-phase audit
> (`docs/GAP_ANALYSIS.md` §6) found broken contracts and fabricated data still on the main path.
> **Do not start new feature work (R6/R7/R8) until Phase R11 is complete.** Full detail and acceptance
> criteria are in `docs/ROADMAP.md` Phase R11; live status is in `PROGRESS.md`.
>
> **Second re-audit 2026-09-19 (`docs/GAP_ANALYSIS.md` §7):** PR #77 marked R11.3 `done` with a diff
> that touched no source file, and the orchestrator's verification passed it. R11.1 was real; R11.2 was
> partial; R11.5 was rightly rejected. R11.3 and R11.14 have since been implemented. The lesson —
> **verification must exercise the task's acceptance criterion, not merely the toolchain** — is
> `docs/DECISIONS.md` ADR-008.

Done: **R11.1** (Whisper/VAD IPC contract), **R11.2** (WebGPU init; captions still placeholder),
**R11.3** (demo mode dev-only), **R11.14** (gate is now body/AST-based and self-tested).

In order — see `docs/ROADMAP.md` for full detail and acceptance criteria:

1. **R11.5** — Real export or honest failure: delete the `setTimeout` progress loop
   (`exportEngine.ts`) and encode the actual timeline, not a `testsrc` fixture (PR #78 was rejected
   for exactly that). Exporting a fixture that writes a real file is still a fabricated export.
2. **R11.4** — Delete the hardcoded demo project that boots on every launch (`timelineStore.ts`).
3. **R11.10** — Initialise the audio engine, insert EQ/limiter into the graph, make the LUFS meter honest.
4. **R11.12** — Wire or delete the orphans the gate now prints on every run
   (`engine/tracking/*`, `voiceIsolation`, `colorManagement`, `vramPool`, `baseEffects`, `Scopes.tsx`).
5. **R11.13** — Implement `src/services/projectPersistence.ts`; there is no native persistence today.
6. **R11.6–R11.11** — desktop import/offline detection, TranscriptEditor, AI console honesty,
   ProgramMonitor controls + caption feed, Scopes/Color workspace.

Everything else is sequenced after these. Do not start a later phase before its dependencies are
`done` in `PROGRESS.md`. **A row may be `done` only when `Impl = real` and a behavioural test is named
in its evidence cell — see `docs/DECISIONS.md` ADR-007.** The gate (`npm test`, exit 1) is a floor,
not a proof: it catches the specific regressions it knows about, and a change can pass it while still
violating its acceptance criterion.

---

## 12. Orchestration loop (Jules dispatch + independent verification)

The OpenHands↔Jules loop runs as the scheduled workflow
`.github/workflows/jules-orchestrator.yml`, executing `scripts/jules-orchestrator.py`
every 30 minutes. It dispatches the next claimable task from `PROGRESS.md` to a Jules
session, waits for the session's PR, verifies that PR independently (fresh clone, `npm ci`,
build, test, lint, invariant gate, tracker-integrity audit), sends any failure back to the
same Jules session, and moves on once the task verifies.

**Why GitHub Actions and not an OpenHands automation.** Two platform behaviours were
confirmed by probe, and they make an automation entrypoint unusable for this loop:

- Stored account secrets do not reach an automation entrypoint. A probe run inside an
  automation sandbox reported `JULES_API_KEY`, `GITHUB_OWNER_TOKEN` and `GITHUB_TOKEN`
  all ABSENT, with only `OPENHANDS_API_KEY` and `SESSION_API_KEY` injected. The same
  secrets were PRESENT in an ordinary interactive conversation. The Cloud API exposes
  only `/api/v1/secrets/search`, which returns names and descriptions but never values,
  so the loop can never authenticate to the Jules API or open PRs from there.
- The automation callback rejects the credential the runtime provides:
  `AUTOMATION_CALLBACK_API_KEY` is unset, so `Authorization: Bearer ` returns HTTP 401
  and the service records the run as FAILED. Posting the callback with the in-sandbox
  `OPENHANDS_API_KEY` authenticates correctly.

**State.** Between runs, state lives on the `automation-state` branch as `state.json`
(the workflow force-pushes it). `ORCHESTRATOR_STATE_FILE` selects the file-backed store;
the automation KV is still used when `AUTOMATION_KV_TOKEN` is present.

**Secrets.** `JULES_API_KEY` and `ORCHESTRATOR_GH_TOKEN` are repo Actions secrets. The
workflow is the only consumer.

**Operating it.** Run `gh workflow run jules-orchestrator.yml`. To force a specific task,
edit `phase`/`task_id` in `state.json` on the `automation-state` branch, or reset the branch
to `{"phase":"idle"}` to let it pick the next claimable row.
