// Self-test for the Claude Code hooks in .claude/hooks/.
//
// WHY THIS EXISTS: the hooks are a verification gate, and CLAUDE.md requires a
// gate modification to ship a demonstrated detection. But there is a sharper
// reason. An adversarial review of the first draft found that the hook SCRIPTS
// were excluded by .git/info/exclude while settings.json referencing them was
// staged - so the branch would have shipped a settings.json advertising a
// fail-closed secrets guard with no guard behind it. A missing hook command
// exits 127, and since only exit 2 blocks, the tool call proceeds.
//
// Nothing would have detected that. This does: `settings.json points at files
// that exist and are executable` is the first test below, and it fails loudly
// on exactly that mistake.
//
// These tests run the real scripts as subprocesses. They never touch a real
// credential file - every fixture is created in a temp dir and every planted
// value is obviously fake.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  accessSync,
  lstatSync,
  constants,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOOKS = join(REPO, '.claude', 'hooks');

/** Run a hook with a JSON payload on stdin; return its exit code. */
function runHook(script, payload, extraEnv = {}) {
  const r = spawnSync(join(HOOKS, script), {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  return r.status;
}

let tmp;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cf-hooktest-'));
  writeFileSync(join(tmp, '.env'), 'FAKE_PLANTED_VALUE=not-real\n');
  writeFileSync(join(tmp, '.env.example'), 'FAKE_PLANTED_VALUE=\n');
  writeFileSync(join(tmp, 'index.ts'), 'export const x = 1;\n');
  symlinkSync(join(tmp, '.env'), join(tmp, 'notes.md'));
  mkdirSync(join(tmp, '.aws'), { recursive: true });
  writeFileSync(join(tmp, '.aws', 'credentials'), 'fake\n');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('hook wiring', () => {
  // THE test that would have caught the tracking defect.
  it('every command in settings.json exists and is executable', () => {
    const settings = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));
    const commands = [];
    for (const entries of Object.values(settings.hooks ?? {})) {
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (h.type === 'command' && h.command) commands.push(h.command);
        }
      }
    }
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      const path = cmd.replace('${CLAUDE_PROJECT_DIR}', REPO);
      expect(
        () => accessSync(path, constants.X_OK),
        `${cmd} must exist and be executable`,
      ).not.toThrow();
    }
  });

  it('hook scripts are tracked by git', () => {
    const tracked = execFileSync('git', ['ls-files', '.claude/hooks'], {
      cwd: REPO,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    expect(tracked).toContain('.claude/hooks/guard-secrets.sh');
    expect(tracked).toContain('.claude/hooks/bus-newline.sh');
    expect(tracked).toContain('.claude/hooks/session-context.sh');
  });

  // The test above is a hardcoded allowlist: it proves those three names are
  // tracked and asserts nothing about the converse. Adversarial review planted
  // the exact historical defect against it - a FOURTH hook, on disk,
  // executable, referenced from settings.json, invisible to `git ls-files` -
  // and the suite stayed green. That defect is the reason this whole PR exists
  // (a settings.json advertising a fail-closed secrets guard with no guard
  // behind it), so the suite has to derive the list from settings.json rather
  // than restate it.
  it('EVERY command referenced in settings.json is a tracked regular FILE', () => {
    const settings = JSON.parse(readFileSync(join(REPO, '.claude/settings.json'), 'utf8'));
    const commands = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((entry) => entry.hooks ?? [])
      .filter((h) => h.type === 'command' && h.command)
      .map((h) => h.command);

    // A registration with no command at all would make the loop below vacuous.
    expect(commands.length).toBeGreaterThan(0);

    for (const raw of commands) {
      // Anything with whitespace is a command line, not a path we can verify.
      expect(raw, `${raw}: hook commands must be a bare path with no arguments`).not.toMatch(/\s/);

      // Require the portable form. A machine-absolute path passes on the
      // author's machine and fails in CI and in every container; a bare
      // relative path depends on the working directory the harness happens to
      // use. Both were accepted by the previous version of this test.
      expect(raw, `${raw}: must start with \${CLAUDE_PROJECT_DIR}/`).toMatch(
        /^\$\{CLAUDE_PROJECT_DIR\}\//,
      );

      const path = raw.replace('${CLAUDE_PROJECT_DIR}/', '');

      // `git ls-files --error-unmatch` takes a PATHSPEC, not a file path. A
      // DIRECTORY satisfies it and expands to its contents - and `accessSync`
      // with X_OK succeeds on a directory too. So the first version of this
      // test passed with `command` pointing at `.claude/hooks`, a hook that
      // cannot execute, which at runtime means a non-2 exit and the tool call
      // proceeding: exactly the "guard advertised, no guard behind it" defect
      // this test exists to prevent. Requiring the output to be this ONE path
      // rejects the directory; the isFile check rejects the rest.
      let listed;
      try {
        listed = execFileSync('git', ['ls-files', '--error-unmatch', '--', path], {
          cwd: REPO,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch {
        throw new Error(`${raw}: not a tracked path in this repo (resolved to '${path}')`);
      }
      expect(listed.trim().split('\n'), `${raw}: must resolve to exactly one tracked path`).toEqual(
        [path],
      );

      // The INDEX mode, not the working tree. Two ways this test was still
      // passing on a broken hook:
      //   - a tracked SYMLINK (mode 120000) whose target git does not carry:
      //     statSync follows the link, so on the author's machine it looked
      //     like a regular file, while a fresh clone got a dangling link, the
      //     hook exited 127, and only exit 2 blocks - fail open.
      //   - a hook committed 100644: executable on the author's disk from
      //     before it was added, non-executable everywhere else, 127 again.
      // `git ls-files -s` reports what a fresh clone will actually get.
      const [mode] = execFileSync('git', ['ls-files', '-s', '--', path], {
        cwd: REPO,
        encoding: 'utf8',
      }).split(' ');
      expect(mode, `${raw}: must be a regular executable file in the index (100755)`).toBe(
        '100755',
      );

      // lstat, so a symlink is rejected here too rather than followed.
      expect(lstatSync(join(REPO, path)).isFile(), `${raw}: must be a regular file`).toBe(true);
    }
  });
});

describe('guard-secrets.sh blocks (exit 2)', () => {
  const cases = [
    ['.env', () => ({ tool_input: { file_path: join(tmp, '.env') } })],
    [
      '.ENV (case-insensitive filesystem)',
      () => ({ tool_input: { file_path: join(tmp, '.ENV') } }),
    ],
    ['a symlink pointing at .env', () => ({ tool_input: { file_path: join(tmp, 'notes.md') } })],
    ['.env.local', () => ({ tool_input: { file_path: join(tmp, '.env.local') } })],
    ['credentials.json', () => ({ tool_input: { file_path: join(tmp, 'credentials.json') } })],
    ['.npmrc', () => ({ tool_input: { file_path: join(tmp, '.npmrc') } })],
    [
      'a path inside .aws/',
      () => ({ tool_input: { file_path: join(tmp, '.aws', 'credentials') } }),
    ],
    ['an ssh private key', () => ({ tool_input: { file_path: '/home/u/.ssh/id_rsa' } })],
    ['a notebook_path payload', () => ({ tool_input: { notebook_path: join(tmp, '.env') } })],
    ['a Grep path payload', () => ({ tool_input: { path: join(tmp, '.env') } })],
    // Added 2026-08-15: adversarial review proved each of these was ALLOWED.
    // `.env.*` needs the dot AFTER env, so neither .envrc nor prod.env matched,
    // and both are mainstream secret-bearing conventions.
    ['.envrc (direnv)', () => ({ tool_input: { file_path: join(tmp, '.envrc') } })],
    [
      'prod.env (the *.env convention)',
      () => ({ tool_input: { file_path: join(tmp, 'prod.env') } }),
    ],
    [
      'terraform.tfvars (this repo has infra/terraform/)',
      () => ({ tool_input: { file_path: join(tmp, 'terraform.tfvars') } }),
    ],
    ['.htpasswd', () => ({ tool_input: { file_path: join(tmp, '.htpasswd') } })],
    ['.pypirc', () => ({ tool_input: { file_path: join(tmp, '.pypirc') } })],
    ['an Apple auth key (.p8)', () => ({ tool_input: { file_path: join(tmp, 'AuthKey_ABC.p8') } })],
    ['a DSA private key', () => ({ tool_input: { file_path: '/home/u/.ssh/id_dsa' } })],
  ];
  for (const [name, mk] of cases) {
    it(name, () => expect(runHook('guard-secrets.sh', mk())).toBe(2));
  }
});

describe('guard-secrets.sh allows (exit 0)', () => {
  it('.env.example, which carries names not values', () => {
    expect(
      runHook('guard-secrets.sh', { tool_input: { file_path: join(tmp, '.env.example') } }),
    ).toBe(0);
  });
  it('ordinary source files', () => {
    expect(runHook('guard-secrets.sh', { tool_input: { file_path: join(tmp, 'index.ts') } })).toBe(
      0,
    );
  });
  it('a payload carrying no path at all', () => {
    expect(runHook('guard-secrets.sh', { tool_input: {} })).toBe(0);
  });
  // The *.tfvars rule was run against `git ls-files` before shipping and hit
  // exactly one tracked file - infra/terraform/example.tfvars, which is a
  // template and reading it is ordinary work. Pinned so the allowlist arm
  // cannot be dropped later without a test going red.
  it('example.tfvars, which is a tracked template', () => {
    expect(
      runHook('guard-secrets.sh', { tool_input: { file_path: join(tmp, 'example.tfvars') } }),
    ).toBe(0);
  });
});

describe('guard-secrets.sh fails CLOSED', () => {
  // A guard that stops guarding must block, not wave things through: its
  // presence is read as coverage.
  it('on a malformed payload', () => {
    expect(runHook('guard-secrets.sh', 'not json at all')).toBe(2);
  });
  it('when jq is unavailable but the shell still works', () => {
    // A PATH of /nonexistent would remove the INTERPRETER too, so the script
    // could not start and would exit 127 - that is the "hook is missing" case,
    // already covered by the wiring tests above. The case worth pinning here is
    // the realistic one: a working shell on a machine or image without jq.
    const shim = mkdtempSync(join(tmpdir(), 'cf-nojq-'));
    for (const bin of ['bash', 'cat', 'printf', 'tr', 'readlink', 'python3', 'env']) {
      for (const dir of ['/bin', '/usr/bin']) {
        try {
          symlinkSync(join(dir, bin), join(shim, bin));
          break;
        } catch {
          /* try the next dir, or skip a binary this OS lacks */
        }
      }
    }
    try {
      expect(
        runHook('guard-secrets.sh', { tool_input: { file_path: '/x/.env' } }, { PATH: shim }),
      ).toBe(2);
    } finally {
      rmSync(shim, { recursive: true, force: true });
    }
  });
});

describe('bus-newline.sh', () => {
  it('flags an ops file with no trailing newline', () => {
    const dir = join(tmp, 'careerforge-v2-ops', 'lanes');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'bad.md');
    writeFileSync(f, 'no trailing newline');
    expect(runHook('bus-newline.sh', { tool_input: { file_path: f } })).toBe(2);
  });
  it('accepts an ops file that ends with a newline', () => {
    const f = join(tmp, 'careerforge-v2-ops', 'lanes', 'good.md');
    writeFileSync(f, 'fine\n');
    expect(runHook('bus-newline.sh', { tool_input: { file_path: f } })).toBe(0);
  });
  it('ignores files outside the ops directory', () => {
    const f = join(tmp, 'elsewhere.md');
    writeFileSync(f, 'no trailing newline');
    expect(runHook('bus-newline.sh', { tool_input: { file_path: f } })).toBe(0);
  });
});

describe('session-context.sh', () => {
  function out(arg) {
    return spawnSync(join(HOOKS, 'session-context.sh'), [arg], { input: '', encoding: 'utf8' })
      .stdout;
  }
  // The harness delivers the mode via `args`, so argv is the primary path.
  // But argv-only testing is a reimplementation of the harness contract rather
  // than the contract itself, which is how the stdin fallback below went
  // missing in the first place - so the payload path is tested too.
  function outFromPayload(source) {
    return spawnSync(join(HOOKS, 'session-context.sh'), [], {
      input: JSON.stringify({ source, hook_event_name: 'SessionStart' }),
      encoding: 'utf8',
    }).stdout;
  }

  it('re-asserts the model law on resume', () => {
    expect(out('resume')).toMatch(/STANDING MODEL LAW/);
  });

  // clear and fork skip the boot ritual exactly as resume does, so the same
  // rationale applies to them; the first version covered resume only.
  for (const mode of ['clear', 'fork']) {
    it(`re-asserts the model law on ${mode}`, () => {
      expect(out(mode)).toMatch(/STANDING MODEL LAW/);
    });
  }

  it('says nothing on an ordinary startup', () => {
    expect(out('startup').trim()).toBe('');
  });

  it('cites the model law by section, not by a version name that would go stale', () => {
    const text = out('resume');
    expect(text).not.toMatch(/opus-?[0-9]/i);
  });

  // The compact branch POINTS at the law rather than restating it. An earlier
  // version quoted the gate sequence inline and had already drifted at birth -
  // it dropped the `set -o pipefail` escape hatch that CLAUDE.md carries. This
  // asserts the pointer exists AND that the quote has not come back, because
  // "does it mention gates" would pass on either shape.
  // GOLDEN TEXT, deliberately. Two weaker versions of this test were defeated:
  // pinning the phrase `pnpm typecheck` (a reword sailed through), then
  // pinning the vocabulary pnpm/typecheck/lint/pipefail (defeated by
  // "run `tsc -b`, then `eslint . && prettier --check .`" - and `\blint\b`
  // does not even match inside "eslint"). No denylist can express "points
  // rather than quotes"; someone has to look.
  //
  // So: the compact text is pinned exactly. Any edit to it fails this test and
  // forces a human to re-read the block and decide whether it has started
  // restating law that lives in CLAUDE.md and .claude/rules/. That friction is
  // the feature - this hook's whole purpose is to avoid becoming a fourth,
  // drifting copy of the gate rules.
  const COMPACT_GOLDEN = `[hook: context was COMPACTED - re-asserting rules compaction tends to drop]
Re-read these rather than trusting a summary of them. They are the ones this
project has actually been bitten by, and all of them are load-bearing:
- CLAUDE.md, "Hard rules" and "Workflow": the gate sequence and the bare-command
  rule, verbatim and complete.
- .claude/rules/verification.md: the planted-FAIL recipe law and the NUL/C0 scan.
- .claude/rules/privacy.md: privacy-check exit 2 means CANNOT RUN, never a pass.
Two that are one line each and are the ones most often lost:
- A check that inspected NOTHING is not a pass. Zero files, zero bytes or zero
  tokens scanned means the check failed to run - report it as such.
- Evidence before claims: show the command and its real output. Outcome text is
  authored AFTER the outcome exists.
`;

  it('emits exactly the pinned compact text (points at the law, never restates it)', () => {
    expect(out('compact')).toBe(COMPACT_GOLDEN);
  });

  // The mode arrived only via argv in the first version. If the harness ever
  // stopped honoring `args`, the script would exit 0 having printed nothing -
  // settings.json advertising a re-injection with nothing behind it, silently.
  it('falls back to the payload source when no argument is passed', () => {
    expect(outFromPayload('resume')).toMatch(/STANDING MODEL LAW/);
    expect(outFromPayload('compact')).toMatch(/CLAUDE\.md/);
    expect(outFromPayload('startup').trim()).toBe('');
  });

  it('degrades quietly when it gets neither an argument nor a usable payload', () => {
    const r = spawnSync(join(HOOKS, 'session-context.sh'), [], {
      input: 'not json at all',
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});
