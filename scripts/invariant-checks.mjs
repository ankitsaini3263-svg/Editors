import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure detection predicates shared by `scripts/verify-invariants.mjs` and its unit tests.
 *
 * These live in their own module so the detection logic can be tested against synthetic
 * violations. A gate whose behaviour is only observable by deliberately breaking the repo is
 * a gate nobody verifies; a gate with unit tests fails loudly the moment its own logic rots.
 */

/** Self-declared placeholder/admission phrases a shader body should never contain. */
const SHADER_PLACEHOLDER_RE = /placeholder (?:shader|effect|implementation)|is a placeholder|not implemented|fake|simulate/i;

/**
 * Shaders whose placeholder status is known, truthful, and tracked. Any shader that admits to
 * being a placeholder without an entry here is a hard failure: the point is that the set of
 * known-fake shaders can only shrink without a deliberate, reviewed edit.
 */
export const KNOWN_TRUTHFUL_PLACEHOLDERS = {
  'caption.wgsl': 'R6.7 / R11.9 — no real text layout engine yet; captions render a colour band',
};

/**
 * Scans a shader directory. Returns `{ unlisted, listed, noFunction }`.
 * - `noFunction`: files with no `fn` definition (cannot be compiled into a pipeline)
 * - `listed`: placeholder shaders that are excused by KNOWN_TRUTHFUL_PLACEHOLDERS
 * - `unlisted`: placeholder shaders that are NOT excused, i.e. a hard failure
 *
 * Comments are deliberately *not* stripped. The failure this catches is a shader that says in
 * its own comments "this is a placeholder" while the PR about it claims a finished pipeline —
 * caption.wgsl did exactly that. A comment is where an author admits the truth, so ignoring
 * comments would ignore the most reliable evidence available in a text file. The cost is that
 * an honest aside can trip the check; the fix is one reviewed entry in the list above, which is
 * the intended workflow.
 */
export function scanShaders(shaderContents) {
  const noFunction = [];
  const unlisted = [];
  const listed = [];
  for (const [name, raw] of Object.entries(shaderContents)) {
    if (!/\bfn\s+\w+\s*\(/.test(raw)) noFunction.push(name);
    if (!SHADER_PLACEHOLDER_RE.test(raw)) continue;
    if (Object.prototype.hasOwnProperty.call(KNOWN_TRUTHFUL_PLACEHOLDERS, name)) {
      listed.push(name);
    } else {
      unlisted.push(name);
    }
  }
  return { noFunction, unlisted, listed };
}

/**
 * Extracts the comment-stripped body of a named top-level function.
 *
 * Body extraction rather than a whole-file substring search is the point: a comment that merely
 * *mentions* `import.meta.env.DEV` satisfies a substring check while gating nothing. That exact
 * bypass was demonstrated against the first version of this gate.
 */
export function functionBody(text, name) {
  const declaration = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{`).exec(text);
  if (!declaration) return null;
  let depth = 0;
  for (let i = declaration.index + declaration[0].length - 1; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = text.slice(declaration.index + declaration[0].length, i);
        return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      }
    }
  }
  return null;
}

/** Demo-mode availability must be gated on the build environment, not just defaulted. */
export function checkDemoGate(runtimeConfigText) {
  const problems = [];
  if (/currentRuntimeMode:\s*RuntimeMode\s*=\s*'demo'/.test(runtimeConfigText)) {
    problems.push("currentRuntimeMode must default to 'live', not 'demo'");
  }
  if (!/currentRuntimeMode:\s*RuntimeMode\s*=\s*'live'/.test(runtimeConfigText)) {
    problems.push("currentRuntimeMode must be explicitly initialized to 'live'");
  }
  const availabilityBody = functionBody(runtimeConfigText, 'isDemoModeAvailable');
  if (availabilityBody === null) {
    problems.push('isDemoModeAvailable() must exist so the demo gate has a single definition');
  } else if (!availabilityBody.includes('import.meta.env.DEV')) {
    problems.push(
      'isDemoModeAvailable() must branch on `import.meta.env.DEV` in its body, so a release build ' +
        'cannot enter demo mode (a `live` default alone is bypassable by one call)'
    );
  }
  return problems;
}

/**
 * Diffs frontend `invoke('<name>')` call sites against the names in Rust's `generate_handler!`
 * (and against `#[tauri::command]` declarations).
 *
 * `invoked` maps command name -> files that call it.
 * Returns `{ missingInRust, declaredButUnregistered, registeredButUnused }`.
 */
export function checkIpcContract({ invoked, registered, declared }) {
  const missingInRust = [];
  const declaredButUnregistered = [];
  const registeredButUnused = [];

  for (const [name, files] of Object.entries(invoked)) {
    if (!registered.includes(name)) missingInRust.push({ name, files });
  }
  for (const name of declared) {
    if (!registered.includes(name)) declaredButUnregistered.push(name);
  }
  for (const name of registered) {
    if (!invoked[name]) registeredButUnused.push(name);
  }
  return { missingInRust, declaredButUnregistered, registeredButUnused };
}

/**
 * Demo fixture literals that must not appear in the boot-time store state.
 *
 * Two kinds, because a hardcoded list alone is defeated by any *new* fixture — which is exactly
 * how this check behaved when first written. The list catches specific known offenders by name;
 * the patterns catch the general shape (a media filename, or a `*_demo_*` / `*_seed_*` id) so a
 * freshly invented fixture is detected too.
 */
export const DEMO_FIXTURE_MARKERS = [
  'proj_demo_01',
  'Interview_Take1.mp4',
  'Upbeat_Lofi_Beat.mp3',
  'Product_Broll.mp4',
];

const DEMO_FIXTURE_PATTERNS = [
  // A quoted media filename literal, e.g. 'Interview_Take1.mp4'.
  /['"`][^'"`\n]+\.(?:mp4|mov|mkv|webm|avi|mp3|wav|aac|flac|m4a)['"`]/g,
  // A demo/seed project id literal.
  /['"`][A-Za-z0-9_]*(?:demo|seed)[A-Za-z0-9_]*['"`]/g,
];

export function findDemoFixtures(timelineStoreText) {
  const found = new Set(DEMO_FIXTURE_MARKERS.filter((m) => timelineStoreText.includes(m)));
  for (const pattern of DEMO_FIXTURE_PATTERNS) {
    for (const match of timelineStoreText.matchAll(pattern)) {
      found.add(match[0].replace(/^['"`]|['"`]$/g, ''));
    }
  }
  return [...found];
}

/** Committed one-shot agent artifacts: not source, and they hide unreviewed changes. */
export const STRAY_ARTIFACT_PATTERNS = [
  /^fix[-_].*\.cjs$/,
  /.*_patch.*\.cjs$/,
  /^update[-_].*\.cjs$/,
  /^test[-_].*\.cjs$/,
  /^dnd.*\.cjs$/,
  /^(build|test|lint)_output\.txt$/,
  /^commit_message\.txt$/,
  /^pr_body\.txt$/,
  /^test_plan\.txt$/,
  /^patch_.*\.js$/,
];

export function findStrayArtifacts(entries) {
  return entries.filter((f) => STRAY_ARTIFACT_PATTERNS.some((p) => p.test(f)));
}

/**
 * Modules with real logic and no inbound import outside themselves: the "orphaned
 * implementation" anti-pattern, where an engine exists, passes its own test, and is never on
 * any execution path.
 */
export function findOrphanedModules({ candidates, sourceFiles, readSource, projectRoot }) {
  const orphaned = [];
  for (const rel of candidates) {
    const base = path.basename(rel).replace(/\.[^.]+$/, '');
    const importPattern = new RegExp(
      `from\\s+['"][^'"]*${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z]+)?['"]`
    );
    const inbound = sourceFiles.filter((file) => {
      const relative = path.relative(projectRoot, file);
      return relative !== rel && importPattern.test(readSource(file));
    }).length;
    if (inbound === 0) orphaned.push(rel);
  }
  return orphaned;
}

/** Reads every `.wgsl` file in a directory into a `{ name: contents }` map. */
export function readShaderDir(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.endsWith('.wgsl')) {
      out[name] = fs.readFileSync(path.join(dir, name), 'utf-8');
    }
  }
  return out;
}