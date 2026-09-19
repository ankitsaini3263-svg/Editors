import { describe, it, expect } from 'vitest';
import {
  scanShaders,
  checkDemoGate,
  checkIpcContract,
  findDemoFixtures,
  findStrayArtifacts,
  findOrphanedModules,
  KNOWN_TRUTHFUL_PLACEHOLDERS,
} from '../scripts/invariant-checks.mjs';

/**
 * These tests pin the gate's own behaviour. Each one constructs a synthetic violation and
 * asserts the gate reports it. Without this, the only way to know a check works is to break the
 * repository on purpose — which is how the previous gate shipped with a one-line string match
 * that no longer fired on the codebase it was written for.
 */

describe('R11.14 — gate detects a reintroduced demo-mode hole (R11.3)', () => {
  it('accepts a correctly gated runtimeConfig', () => {
    const ok = [
      "let currentRuntimeMode: RuntimeMode = 'live';",
      'export function isDemoModeAvailable(): boolean {',
      '  return import.meta.env.DEV;',
      '}',
    ].join('\n');
    expect(checkDemoGate(ok)).toEqual([]);
  });

  it('rejects a demo default', () => {
    const bad = "let currentRuntimeMode: RuntimeMode = 'demo';\nconst x = import.meta.env.DEV;";
    expect(checkDemoGate(bad).join(' ')).toMatch(/default to 'live'/);
  });

  it('rejects a live default that is not build-gated (the exact R11.3 bug)', () => {
    // This is what shipped and was marked done: correct default, no gate at all.
    const ungated = [
      "let currentRuntimeMode: RuntimeMode = 'live';",
      'export function isDemoModeAvailable(): boolean { return true; }',
    ].join('\n');
    expect(checkDemoGate(ungated).join(' ')).toMatch(/import\.meta\.env\.DEV/);
  });

  it('is not fooled by a comment that merely mentions the dev flag', () => {
    // Demonstrated bypass of the first version of this check: the whole file contained the
    // string `import.meta.env.DEV`, in a comment, while gating nothing.
    const commentBypass = [
      "let currentRuntimeMode: RuntimeMode = 'live';",
      '// in production import.meta.env.DEV is false, so demo mode is disabled',
      'export function isDemoModeAvailable(): boolean { return true; }',
    ].join('\n');
    expect(checkDemoGate(commentBypass).join(' ')).toMatch(/import\.meta\.env\.DEV/);
  });

  it('requires the availability gate to exist at all', () => {
    const noGate = "let currentRuntimeMode: RuntimeMode = 'live';\n";
    expect(checkDemoGate(noGate).join(' ')).toMatch(/isDemoModeAvailable/);
  });
});

describe('R11.14 — gate detects a broken invoke/command contract (R11.1)', () => {
  it('flags a frontend invoke with no registered Rust command', () => {
    const result = checkIpcContract({
      invoked: { transcribe_audio: ['src/services/whisperTranscriber.ts'] },
      registered: ['run_whisper_stt'],
      declared: ['run_whisper_stt'],
    });
    expect(result.missingInRust).toEqual([
      { name: 'transcribe_audio', files: ['src/services/whisperTranscriber.ts'] },
    ]);
  });

  it('flags a declared-but-unregistered command and a registered-but-unused one', () => {
    const result = checkIpcContract({
      invoked: { probe_media: ['src/services/nativeBridge.ts'] },
      registered: ['probe_media', 'orphan_cmd'],
      declared: ['probe_media', 'ghost_cmd'],
    });
    expect(result.declaredButUnregistered).toEqual(['ghost_cmd']);
    expect(result.registeredButUnused).toEqual(['orphan_cmd']);
  });

  it('accepts a matching contract', () => {
    const result = checkIpcContract({
      invoked: { run_whisper_stt: ['src/services/whisperTranscriber.ts'] },
      registered: ['run_whisper_stt'],
      declared: ['run_whisper_stt'],
    });
    expect(result.missingInRust).toEqual([]);
    expect(result.registeredButUnused).toEqual([]);
  });
});

describe('R11.14 — gate detects a placeholder shader', () => {
  it('flags an unlisted shader that admits to being a placeholder', () => {
    const { unlisted } = scanShaders({
      'brand_new.wgsl': '// this is a placeholder shader\nfn apply() -> vec3<f32> { return vec3<f32>(1.0); }',
    });
    expect(unlisted).toEqual(['brand_new.wgsl']);
  });

  it('excuses a shader listed in KNOWN_TRUTHFUL_PLACEHOLDERS', () => {
    const { unlisted, listed } = scanShaders({
      'caption.wgsl': '// This is a placeholder shader.\nfn applyCaptionHighlight() -> vec3<f32> { return vec3<f32>(1.0); }',
    });
    expect(listed).toEqual(['caption.wgsl']);
    expect(unlisted).toEqual([]);
  });

  it('flags a shader with no function definition', () => {
    const { noFunction } = scanShaders({ 'hollow.wgsl': 'struct U { a: f32 };\n// no fn here' });
    expect(noFunction).toEqual(['hollow.wgsl']);
  });

  it('flags an admission of being fake even inside a comment', () => {
    // Deliberate: an author writing "this is a placeholder shader" in a comment is the most
    // reliable evidence a shader is not real. caption.wgsl did exactly that.
    const { unlisted } = scanShaders({
      'liar.wgsl': '// Unlike a placeholder shader, this one is real.\nfn main_image() -> vec4<f32> { return vec4<f32>(1.0); }',
    });
    expect(unlisted).toEqual(['liar.wgsl']);
  });

  it('passes a shader with no fake-talk anywhere', () => {
    const { unlisted } = scanShaders({
      'real.wgsl': 'fn yuv_to_rgb(c: vec3<f32>) -> vec3<f32> { return c; }',
    });
    expect(unlisted).toEqual([]);
  });

  it('keeps the known-placeholder list small and documented', () => {
    // If this list grows without the entry naming a tracking task, the gate is being weakened.
    for (const [name, reason] of Object.entries(KNOWN_TRUTHFUL_PLACEHOLDERS)) {
      expect(reason, `${name} must name the task that removes it`).toMatch(/R\d+\.\d+/);
    }
  });

  it('classifies each flagged shader exactly once, with no overlap between buckets', () => {
    // The failure mode this guards: a check that stops matching real files reports nothing and
    // looks like a pass. unlisted/listed must partition the placeholder-marked files, and
    // nothing may be both excused and rejected.
    const shaders = {
      'a.wgsl': 'fn a() -> f32 { return 1.0; }',
      'b.wgsl': '// this is a placeholder shader\nfn b() -> f32 { return 1.0; }',
      'c.wgsl': '// no function at all',
      'd.wgsl': '// is a placeholder\nfn d() -> f32 { return 1.0; }',
    };
    const { unlisted, listed, noFunction } = scanShaders(shaders);

    expect(unlisted).toEqual(['b.wgsl', 'd.wgsl']);
    expect(listed).toEqual([]);
    expect(noFunction).toEqual(['c.wgsl']);

    const overlap = unlisted.filter((f) => listed.includes(f));
    expect(overlap, 'a file must not be both excused and rejected').toEqual([]);
  });

  it('moves a file out of unlisted the moment it is listed (and vice versa)', () => {
    const body = '// this is a placeholder shader\nfn x() -> f32 { return 1.0; }';
    const before = scanShaders({ 'x.wgsl': body });
    const after = scanShaders({ 'caption.wgsl': body });
    expect(before.unlisted).toEqual(['x.wgsl']);
    expect(after.listed).toEqual(['caption.wgsl']);
    expect(after.unlisted).toEqual([]);
  });
});

describe('R11.14 — gate detects fabricated boot fixtures (R11.4)', () => {
  it('finds demo literals in the store', () => {
    const store = "const initial = { projectId: 'proj_demo_01', name: 'Interview_Take1.mp4' };";
    expect(findDemoFixtures(store)).toEqual(['proj_demo_01', 'Interview_Take1.mp4']);
  });

  it('catches a brand-new fixture the hardcoded list has never seen', () => {
    // The original check was a fixed name list, so any newly invented fixture was invisible.
    // This is that bypass, pinned.
    const store = "const initial = { name: 'Client_Testimonial_FINAL_v3.mp4' };";
    expect(findDemoFixtures(store)).toContain('Client_Testimonial_FINAL_v3.mp4');
  });

  it('catches a new demo-id literal and audio filenames', () => {
    expect(findDemoFixtures("const x = { id: 'proj_demo_42' };")).toContain('proj_demo_42');
    expect(findDemoFixtures("const x = { name: 'scratch_vo.wav' };")).toContain('scratch_vo.wav');
  });

  it('passes an empty initial store', () => {
    expect(findDemoFixtures('const initial = { tracks: [], clips: [] };')).toEqual([]);
  });

  it('does not flag ordinary identifiers that merely contain a media-ish substring', () => {
    expect(findDemoFixtures("const mediaType = 'video'; const rate = 48000;")).toEqual([]);
  });
});

describe('R11.14 — gate detects orphaned modules and stray artifacts (R11.12)', () => {
  it('flags a module with no inbound import', () => {
    const orphaned = findOrphanedModules({
      candidates: ['src/engine/orphan.ts'],
      sourceFiles: ['/repo/src/main.ts'],
      readSource: () => "import { x } from './other';",
      projectRoot: '/repo',
    });
    expect(orphaned).toEqual(['src/engine/orphan.ts']);
  });

  it('clears a module once something imports it', () => {
    const orphaned = findOrphanedModules({
      candidates: ['src/engine/wired.ts'],
      sourceFiles: ['/repo/src/main.ts'],
      readSource: () => "import { x } from '../engine/wired';",
      projectRoot: '/repo',
    });
    expect(orphaned).toEqual([]);
  });

  it('flags the residue of single-pass agent runs', () => {
    const stray = findStrayArtifacts([
      'fix-ts2.cjs',
      'web_import_patch_3.cjs',
      'commit_message.txt',
      'update-topbar.cjs',
      'vite.config.ts',
      'package.json',
      'README.md',
    ]);
    expect(stray).toEqual([
      'fix-ts2.cjs',
      'web_import_patch_3.cjs',
      'commit_message.txt',
      'update-topbar.cjs',
    ]);
  });
});