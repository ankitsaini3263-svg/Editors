import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  scanShaders,
  checkDemoGate,
  checkIpcContract,
  findDemoFixtures,
  findStrayArtifacts,
  findOrphanedModules,
  readShaderDir,
  KNOWN_TRUTHFUL_PLACEHOLDERS,
} from './invariant-checks.mjs';

/**
 * Mechanical Invariant Verification Script
 * This script runs as part of test/CI gates to prevent agents (Jules, OpenHands, etc.)
 * from shipping single-pass stubs, rubber-stamped PRs, or unsafe defaults.
 *
 * Detection logic lives in `scripts/invariant-checks.mjs` and is unit-tested by
 * `__tests__/invariant-checks.test.mjs`. That matters: every check in here was added because a
 * previous check was too weak to catch a real violation, and the only way to keep these honest
 * is to prove they fire on synthetic violations.
 *
 * ## Two severities, and why pre-existing debt does not fail the build
 *
 * `docs/ROADMAP.md` R11.14 states the acceptance criterion simply: *reintroducing* a violation
 * must make `npm test` fail. "Reintroducing" implies the state that exists today is the tolerated
 * floor. So `scripts/invariant-baseline.json` records the known debt (one entry per finding), and:
 *
 *   - a violation NOT in the baseline  -> ERROR   (exit 1). This is the acceptance criterion.
 *   - a violation IN the baseline      -> WARNING (printed, with the task that clears it).
 *   - a baseline entry that no longer reproduces -> ERROR. The debt was fixed; the baseline must
 *     shrink in the same commit, so the tolerance can never silently outlive the problem.
 *
 * That last rule is what keeps the baseline honest. Without it, a fixed finding would stay
 * tolerated forever and the gate would drift back to being decorative.
 *
 * A substring check is deliberately avoided where the shape of the code matters. The previous
 * gate asserted that the *identifier* `solveCubicBezier` appeared in a file, which a
 * `return x;` body satisfies. Anything a comment or a rename can satisfy is not a check.
 */

const projectRoot = process.cwd();
const errors = [];
const warnings = [];

const baseline = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'scripts/invariant-baseline.json'), 'utf-8')
);

/** Record a finding: fatal if unseen before, tolerated (but still printed) if baselined. */
function finding({ key, bucket, message, task }) {
  const tolerated = Array.isArray(baseline[bucket]) && baseline[bucket].includes(key);
  if (tolerated) {
    warnings.push(`${task}: ${message}`);
  } else {
    errors.push(`${task} Violation: ${message} (not in scripts/invariant-baseline.json)`);
  }
}

// Every baseline entry that should have reproduced this run. Anything missing at the end is a
// tolerance that outlived its problem.
const observed = new Set();
function markObserved(bucket, key) {
  observed.add(`${bucket}\u0000${key}`);
}
function assertBaselineStillReproduces() {
  for (const [bucket, keys] of Object.entries(baseline)) {
    if (!Array.isArray(keys)) continue;
    for (const key of keys) {
      if (!observed.has(`${bucket}\u0000${key}`)) {
        errors.push(
          `Baseline entry no longer reproduces: ${bucket} = '${key}'. The debt appears fixed — ` +
            'remove it from scripts/invariant-baseline.json in this same change so the tolerance ' +
            'cannot silently outlive the problem.'
        );
      }
    }
  }
}

function readFile(relPath) {
  const fullPath = path.join(projectRoot, relPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null;
}

function requireFile(relPath) {
  const content = readFile(relPath);
  if (content === null) errors.push(`Missing required file: ${relPath}`);
  return content;
}

/** Every string literal passed as the first argument to `invoke(...)` or `obj.invoke(...)`. */
function invokedCommandNames(sourceFile) {
  const names = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isInvoke = ts.isIdentifier(callee) && callee.text === 'invoke';
      const isMemberInvoke = ts.isPropertyAccessExpression(callee) && callee.name.text === 'invoke';
      if (isInvoke || isMemberInvoke) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) names.push(first.text);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return names;
}

function listSourceFiles(dir) {
  const out = [];
  const base = path.join(projectRoot, dir);
  if (!fs.existsSync(base)) return out;
  const stack = [base];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        stack.push(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

console.log('🔍 Running Mechanical Invariant Checks...');

// ---------------------------------------------------------------- §5.5 safe-by-default (R11.3)

const runtimeConfigContent = readFile('src/services/runtimeConfig.ts');
if (runtimeConfigContent) {
  for (const problem of checkDemoGate(runtimeConfigContent)) {
    errors.push(`§5.5 / R11.3 Violation: runtimeConfig.ts: ${problem}.`);
  }
}

// ---------------------------------------------------------------- §5.7 fabricated trajectories

const sam2Content = readFile('src/engine/sam2Masking.ts');
if (sam2Content && sam2Content.includes('Math.sin(i * 0.1)')) {
  errors.push("Invariant §5.7 Violation: Fabricated trajectory 'Math.sin(i * 0.1)' found in sam2Masking.ts.");
}

// ---------------------------------------------------------------- Row 10 real Bezier solver
//
// The previous check asserted only that the identifiers appear. A `return x;` body satisfies
// that while computing no curve, so the gate could not tell a real solver from a linear stub.
// Verified here by requiring the behavioural suite, which pins exact CSS-Bezier output values.

const keyframingContent = requireFile('src/utils/keyframing.ts');
if (keyframingContent) {
  if (!keyframingContent.includes('export function solveCubicBezier') ||
      !keyframingContent.includes('export function evaluateEasing')) {
    errors.push('Row 10 Violation: keyframing.ts must export solveCubicBezier and evaluateEasing.');
  }
}
requireFile('src/__tests__/keyframing.behavior.test.ts');

// ---------------------------------------------------------------- §5.5 native engines fail loudly

const whisperRust = requireFile('src-tauri/src/whisper_onnx.rs');
if (whisperRust && whisperRust.includes('full_text: "Welcome to CineCraft AI')) {
  errors.push('Invariant §5.5 Violation: Native Whisper Rust engine contains a hardcoded fake transcript on the main path.');
}

const sileroRust = requireFile('src-tauri/src/silero_vad.rs');
if (sileroRust && sileroRust.includes('start_time: 5.0') && sileroRust.includes('Ok(vec![')) {
  errors.push('Invariant §5.5 Violation: Native Silero Rust engine contains hardcoded fake silence segments on the main path.');
}

// ---------------------------------------------------------------- R11.1 invoke/command contract
//
// A frontend `invoke('foo')` with no matching registered command fails only at runtime, inside a
// packaged desktop app, where nothing catches it. This is exactly how the real Whisper engine
// stayed unreachable while every JS test passed.

const mainRs = requireFile('src-tauri/src/main.rs');
if (mainRs) {
  const handlerBlock = mainRs.match(/generate_handler!\[([\s\S]*?)\]/);
  const registered = handlerBlock
    ? handlerBlock[1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const declared = [...mainRs.matchAll(/fn\s+([a-z_0-9]+)\s*\(/g)].map((m) => m[1]);

  const invoked = {};
  for (const file of listSourceFiles('src')) {
    const rel = path.relative(projectRoot, file);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf-8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    for (const name of invokedCommandNames(source)) {
      (invoked[name] ||= []).push(rel);
    }
  }

  if (registered.length === 0) {
    errors.push('R11.1 Violation: could not parse any command names from `generate_handler!` in src-tauri/src/main.rs.');
  } else {
    const contract = checkIpcContract({ invoked, registered, declared });
    for (const { name, files } of contract.missingInRust) {
      errors.push(
        `R11.1 Violation: src invokes '${name}' (${files.join(', ')}) but no matching command is ` +
          `registered in generate_handler!. Registered: ${registered.join(', ')}.`
      );
    }
    for (const name of contract.registeredButUnused) {
      finding({
        key: name,
        bucket: 'registeredButUnused',
        task: 'R11.1',
        message:
          `Rust command '${name}' is registered but invoked from nowhere in src/. ` +
          'Either wire it or remove it — dead native code hides a missing feature.',
      });
      markObserved('registeredButUnused', name);
    }
  }
}

// ---------------------------------------------------------------- §5.7 no placeholder shaders
//
// A shader that announces itself as a placeholder still compiles and still produces a frame, so
// it renders "successfully" while rendering nothing real. Shaders whose placeholder status is
// known and tracked must be listed in KNOWN_TRUTHFUL_PLACEHOLDERS; the set can only shrink
// without a deliberate, reviewed edit.

const shaders = readShaderDir(path.join(projectRoot, 'src/engine/shaders'));
if (Object.keys(shaders).length > 0) {
  const { noFunction, unlisted, listed } = scanShaders(shaders);
  for (const name of noFunction) {
    errors.push(`§5.7 Violation: src/engine/shaders/${name} defines no function; it cannot be part of a pipeline.`);
  }
  for (const name of unlisted) {
    errors.push(
      `§5.7 Violation: src/engine/shaders/${name} marks itself placeholder/simulated and is not in ` +
        'KNOWN_TRUTHFUL_PLACEHOLDERS. Either implement it, fail loudly, or add it to the list with the ' +
        'task that will replace it.'
    );
  }
  for (const name of listed) {
    finding({
      key: name,
      bucket: 'placeholderShaders',
      task: '§5.7',
      message: `src/engine/shaders/${name} is a known placeholder — ${KNOWN_TRUTHFUL_PLACEHOLDERS[name]}.`,
    });
    markObserved('placeholderShaders', name);
  }
}

// ---------------------------------------------------------------- R11.4 no fabricated boot project

const timelineStore = readFile('src/store/timelineStore.ts');
if (timelineStore) {
  for (const key of findDemoFixtures(timelineStore)) {
    finding({
      key,
      bucket: 'demoFixtures',
      task: 'R11.4',
      message:
        `timelineStore.ts still contains the demo fixture literal '${key}'. ` +
        'The app boots with media the user never imported.',
    });
    markObserved('demoFixtures', key);
  }
}

// ---------------------------------------------------------------- R11.12 orphaned modules

const ORPHAN_CANDIDATES = [
  'src/engine/voiceIsolation.ts',
  'src/engine/colorManagement.ts',
  'src/engine/vramPool.ts',
  'src/engine/effects/baseEffects.ts',
  'src/components/Scopes.tsx',
  'src/engine/tracking/sam2.ts',
];
const sourceFiles = listSourceFiles('src');
for (const rel of findOrphanedModules({
  candidates: ORPHAN_CANDIDATES.filter((c) => fs.existsSync(path.join(projectRoot, c))),
  sourceFiles,
  readSource: (f) => fs.readFileSync(f, 'utf-8'),
  projectRoot,
})) {
  finding({
    key: rel,
    bucket: 'orphanedModules',
    task: 'R11.12',
    message: `${rel} has zero inbound imports outside itself, so it is on no execution path.`,
  });
  markObserved('orphanedModules', rel);
}

// ---------------------------------------------------------------- R11.12 stray agent artifacts

for (const name of findStrayArtifacts(fs.readdirSync(projectRoot))) {
  finding({
    key: name,
    bucket: 'strayArtifacts',
    task: 'R11.12',
    message: `stray one-shot agent artifact committed at repo root: ${name}. Remove it.`,
  });
  markObserved('strayArtifacts', name);
}

// ---------------------------------------------------------------- baseline integrity

assertBaselineStillReproduces();

// ---------------------------------------------------------------- report

if (warnings.length > 0) {
  console.warn('\n⚠️  Baselined debt still present (non-fatal; each names the task that removes it):');
  warnings.forEach((w, i) => console.warn(`  ${i + 1}. ${w}`));
}

if (errors.length > 0) {
  console.error('\n❌ MECHANICAL INVARIANT CHECKS FAILED:');
  errors.forEach((err, idx) => console.error(`  ${idx + 1}. ${err}`));
  console.error(
    '\nA new violation is a regression: previously the repo did not contain it. Agents must not mark\n' +
      'tasks "done" or proceed until all invariants pass cleanly. If the finding is pre-existing and\n' +
      'tracked, add it to scripts/invariant-baseline.json in the same commit that documents it.\n'
  );
  process.exit(1);
}

console.log('\n✅ All mechanical invariants passed cleanly.');
if (warnings.length > 0) {
  console.log(
    `   (${warnings.length} baselined finding(s) reported above — tracked, not ignored. ` +
      'Each disappears when its task is fixed and the baseline entry is removed.)'
  );
}
process.exit(0);