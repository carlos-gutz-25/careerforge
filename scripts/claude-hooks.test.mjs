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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  renameSync,
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

      // AND IT MUST ACTUALLY RUN. Every previous version of this test stayed
      // inside the "is it there?" family - tracked, one path, mode 100755, a
      // regular file - and a fourth vacuous pass was found each time. The last
      // one: a 0-byte file with mode 100755 satisfies all of the above and
      // exits 126 when spawned. 126 has the same consequence as the 127 this
      // file's own header describes - neither is 2, so the tool call proceeds
      // and the guard is a facade. Presence is not execution.
      const probe = spawnSync(join(REPO, path), {
        input: JSON.stringify({ tool_input: {} }),
        encoding: 'utf8',
      });
      expect(probe.error, `${raw}: could not be spawned`).toBeUndefined();
      expect(
        [126, 127],
        `${raw}: spawned but could not execute (exit ${probe.status})`,
      ).not.toContain(probe.status);
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
    // The credential DIRECTORY itself. Grep is in the matcher so that a
    // directory-scoped search is guarded, and a recursive grep over ~/.ssh is
    // the credential dump the rule exists to stop - it was allowed until now.
    ['the .ssh directory itself, via Grep', () => ({ tool_input: { path: '/home/u/.ssh' } })],
    ['a bare relative .aws directory', () => ({ tool_input: { file_path: '.aws' } })],
    ['the .gnupg directory itself', () => ({ tool_input: { file_path: '/home/u/.gnupg' } })],
    [
      'a backup copy of a docker credential file',
      () => ({ tool_input: { file_path: '/home/u/.docker/config.json.bak' } }),
    ],
    // A Grep GLOB needs no path at all: pattern "=" + glob "**/.env*" reads
    // credential VALUES into the transcript while every path arm sees an empty
    // payload. Proven allowed by the closeout adversarial review 2026-08-15.
    ['a Grep glob targeting .env', () => ({ tool_input: { pattern: '=', glob: '**/.env*' } })],
    [
      'a Grep glob targeting ssh keys',
      () => ({ tool_input: { pattern: 'BEGIN', glob: '**/id_rsa*' } }),
    ],
    // kubeconfig coverage: the exact basename was matched but the mainstream
    // shapes were not - both proven allowed by the same review.
    ['kubeconfig.yaml', () => ({ tool_input: { file_path: join(tmp, 'kubeconfig.yaml') } })],
    ['~/.kube/config', () => ({ tool_input: { file_path: '/home/u/.kube/config' } })],
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
  // Pins that the glob arm does not false-block ordinary searches - the same
  // no-false-block discipline as the tracked-file sweep for *.tfvars above.
  it('an innocuous source glob', () => {
    expect(runHook('guard-secrets.sh', { tool_input: { pattern: 'foo', glob: '**/*.ts' } })).toBe(
      0,
    );
  });
  it('a glob plus an ordinary path together', () => {
    expect(
      runHook('guard-secrets.sh', {
        tool_input: { pattern: 'foo', glob: '*.vue', path: join(tmp, 'src') },
      }),
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

  // Pinning the STRING is not enough: renaming one of the files it points at
  // would leave the hook citing a dead path with this suite green, which is a
  // pointer that has quietly stopped pointing anywhere.
  it('every path the compact text cites actually exists', () => {
    for (const rel of ['CLAUDE.md', '.claude/rules/verification.md', '.claude/rules/privacy.md']) {
      expect(COMPACT_GOLDEN, `${rel} should be cited by the compact text`).toContain(rel);
      expect(() => accessSync(join(REPO, rel), constants.R_OK), `${rel} must exist`).not.toThrow();
    }
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

// ---------------------------------------------------------------------------
// v-next dispatch cutover invariants (2026-08-17). Each of these is a rule
// that was once prose and got mechanically enforced after the mangled-claim /
// do-nothing-agent incidents. If one fails, the enforcement layer regressed -
// do not weaken the test; fix the settings or the hook.
// ---------------------------------------------------------------------------
describe('v-next cutover invariants', () => {
  const settings = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));

  it('boot.md is commit-eligible and credential shapes under commands/ stay ignored', () => {
    const ok = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '.claude/commands/boot.md']);
    expect(ok.status, 'boot.md must NOT be gitignored').toBe(1);
    for (const bad of [
      '.claude/commands/.env',
      '.claude/commands/x.env',
      '.claude/commands/.env.local',
    ]) {
      const r = spawnSync('git', ['-C', REPO, 'check-ignore', '-q', bad]);
      expect(r.status, `${bad} must stay gitignored`).toBe(0);
    }
  });

  it('registers the four v-next hooks with timeout 5 on the guards', () => {
    const pre = settings.hooks.PreToolUse;
    const fence = pre.find((e) => e.matcher === '*');
    const bus = pre.find((e) => e.matcher === 'Bash');
    expect(fence?.hooks[0].command).toContain('guard-fence.sh');
    expect(fence?.hooks[0].timeout).toBe(5);
    expect(bus?.hooks[0].command).toContain('guard-bus-writes.sh');
    expect(bus?.hooks[0].timeout).toBe(5);
    expect(JSON.stringify(settings.hooks.Stop ?? [])).toContain('stop-heartbeat.sh');
    expect(JSON.stringify(settings.hooks.SessionEnd ?? [])).toContain('sessionend-release.sh');
  });

  it('Stop and SessionEnd hooks exit 0 no matter what (a Stop exit 2 forces the turn to continue)', () => {
    for (const script of ['stop-heartbeat.sh', 'sessionend-release.sh']) {
      for (const input of ['', 'not json', '{}']) {
        const r = spawnSync(join(HOOKS, script), [], {
          input,
          encoding: 'utf8',
          env: { ...process.env, CF_STATE_ROOT: '/nonexistent-state-root' },
        });
        expect(
          r.status,
          `${script} must exit 0 (got ${r.status} on input ${JSON.stringify(input)})`,
        ).toBe(0);
      }
    }
  });

  // The tracked settings file is the one every seat clone syncs from, so the
  // deny rules that apply fleet-wide have to be IN it - a settings.local.json
  // on one machine is not a perimeter. The merge/push bans are deliberately
  // NOT here: this clone is the ceremony seat, the fleet's single merge
  // authority, and deny beats allow, so denying `gh pr merge` in the tracked
  // file would disarm the one seat that is supposed to merge. Those rules are
  // applied to the OTHER seats' settings at cutover sync time (design r4
  // amendment H).
  it('tracked permission perimeter: fleet-wide denies present, ceremony merge authority intact', () => {
    const deny = settings.permissions?.deny ?? [];
    expect(deny, "the clone's own .claude/ must be Edit-denied").toContain('Edit(./.claude/**)');
    expect(deny, 'git config rewrites identity/hooks fleet-wide').toContain('Bash(git config:*)');
    for (const rule of deny) {
      expect(
        /^Bash\(gh pr merge/.test(rule),
        `${rule}: the CEREMONY clone must keep its merge authority`,
      ).toBe(false);
    }
  });

  it('no dead-rule families anywhere (Write/NotebookEdit/Glob path rules are accepted but never consulted)', () => {
    const files = [
      join(REPO, '.claude', 'settings.json'),
      join(REPO, '.claude', 'settings.local.json'),
    ];
    for (const f of files) {
      let raw;
      try {
        raw = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      for (const dead of ['"Write(', '"NotebookEdit(', '"Glob(', '"MultiEdit(']) {
        expect(
          raw,
          `${f} contains dead rule family ${dead} - use Edit( which governs all four`,
        ).not.toContain(dead);
      }
    }
  });

  it('no escape-hatch allow rules (claude/docker/chmod spawn or perimeter escapes)', () => {
    const files = [
      join(REPO, '.claude', 'settings.json'),
      join(REPO, '.claude', 'settings.local.json'),
    ];
    for (const f of files) {
      let cfg;
      try {
        cfg = JSON.parse(readFileSync(f, 'utf8'));
      } catch {
        continue;
      }
      for (const rule of cfg.permissions?.allow ?? []) {
        expect(
          /^Bash\((claude|docker|chmod)[ :)]/.test(rule),
          `${f}: escape allow rule ${rule}`,
        ).toBe(false);
      }
    }
  });

  it('guard-fence allows an unmanaged clone (no .claude/seat) so ordinary repos are untouched', () => {
    const status = runHook(
      'guard-fence.sh',
      { tool_name: 'Bash', tool_input: { command: 'echo hi' }, session_id: 'test' },
      { CLAUDE_PROJECT_DIR: '/tmp' },
    );
    expect(status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The early-allow (design r4 amendment I). Both guards let the canonical seat
// CLI through before any failable code, because a guard bug must never be able
// to stop heartbeats fleet-wide. That carve-out was a prefix match on
// "<canon> " until 2026-08-17, which made it a universal bypass of BOTH hooks:
// `<canon> --help; rm -rf <state>` starts with the canonical path.
// ---------------------------------------------------------------------------
const CANON_HOST = '/Users/carlos/careerforge-state/bin/seat';
const CANON_CONTAINER = '/home/node/careerforge-state/bin/seat';

/** Extract is_lone_seat_cmd from a hook and run it in isolation. */
function isLoneSeatCmd(script, cmd, patterns = [CANON_HOST, CANON_CONTAINER]) {
  const src = readFileSync(join(HOOKS, script), 'utf8');
  const start = src.indexOf('is_lone_seat_cmd() {');
  expect(start, `${script} must define is_lone_seat_cmd`).toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  const fn = src.slice(start, end + 3);
  const r = spawnSync('bash', ['-c', `${fn}\nis_lone_seat_cmd "$@"`, 'hook', cmd, ...patterns], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

describe('early-allow is one simple seat-CLI command and nothing more', () => {
  const NL = String.fromCharCode(10);
  const cases = [
    // [command, allowed?]
    [CANON_HOST, true],
    [`${CANON_HOST} claim --seat ceremony-agent --interactive`, true],
    [`${CANON_CONTAINER} heartbeat --seat b1-portfolio --quiet`, true],
    // Every one of these was allowed by the old prefix match.
    [`${CANON_HOST} --help; echo PWNED`, false],
    [`${CANON_HOST} status && rm -rf /Users/carlos/careerforge-state/claims`, false],
    [`${CANON_HOST} status | tee /Users/carlos/careerforge-v2-ops/DISPATCH.md`, false],
    [`${CANON_HOST} status > /Users/carlos/careerforge-v2-ops/DISPATCH.md`, false],
    [`${CANON_HOST} x${NL}rm -rf /Users/carlos/careerforge-state/claims`, false],
    [`${CANON_HOST} $(rm -rf /Users/carlos/careerforge-state)`, false],
    [`${CANON_HOST} \`id\``, false],
    [`${CANON_HOST} status & echo backgrounded`, false],
    // argv[0] must BE the pinned path, not merely contain it.
    ['/tmp/evil /Users/carlos/careerforge-state/bin/seat', false],
    [`echo ${CANON_HOST}`, false],
    [`${CANON_HOST}-not-really claim`, false],
    ['seat claim --seat x', false],
    [` ${CANON_HOST} claim`, false],
  ];

  // Two copies of one rule drift apart silently, and the whole point of the
  // helper is that the two hooks agree about what a lone seat command is. So
  // the matrix runs against BOTH and asserts they answer identically.
  for (const [cmd, allowed] of cases) {
    const label = JSON.stringify(cmd);
    it(`${allowed ? 'allows' : 'refuses'} ${label} in both guards`, () => {
      const fence = isLoneSeatCmd('guard-fence.sh', cmd);
      const bus = isLoneSeatCmd('guard-bus-writes.sh', cmd);
      expect(fence, `guard-fence verdict for ${label}`).toBe(allowed);
      expect(bus, `guard-bus-writes verdict for ${label}`).toBe(allowed);
    });
  }

  it('pins the canonical seat paths verbatim in both guards', () => {
    for (const script of ['guard-fence.sh', 'guard-bus-writes.sh']) {
      const src = readFileSync(join(HOOKS, script), 'utf8');
      expect(src, `${script} must pin the host seat path`).toContain(CANON_HOST);
      expect(src, `${script} must pin the container seat path`).toContain(CANON_CONTAINER);
    }
  });

  it('guard-bus-writes also carves out the wrapper and bus-append', () => {
    for (const [cmd, allowed] of [
      [`${CANON_HOST}-wrapper b1 sp-1 item 1 model -- /tmp/p.md`, true],
      ['/Users/carlos/careerforge-v2-ops/ops-tools/bus-append.sh carlos "hello"', true],
      ['/Users/carlos/careerforge-v2-ops/ops-tools/bus-append.sh carlos "hi"; rm -rf /', false],
    ]) {
      expect(
        isLoneSeatCmd('guard-bus-writes.sh', cmd, [
          CANON_HOST,
          CANON_CONTAINER,
          `${CANON_HOST}-wrapper`,
          `${CANON_CONTAINER}-wrapper`,
          '*/ops-tools/bus-append.sh',
        ]),
        `${cmd}`,
      ).toBe(allowed);
    }
  });
});

// ---------------------------------------------------------------------------
// guard-bus-writes: what it denies, and just as importantly what it does not.
// Nothing here touches a guarded root - the hook only RESOLVES the paths named
// in the command string, it never runs the command.
// ---------------------------------------------------------------------------
describe('guard-bus-writes denies positively-resolved writes into guarded roots', () => {
  const STATE = '/Users/carlos/careerforge-state';
  const OPS = '/Users/carlos/careerforge-v2-ops';

  function verdict(command, cwd = REPO) {
    return runHook(
      'guard-bus-writes.sh',
      { tool_name: 'Bash', cwd, tool_input: { command } },
      { CLAUDE_PROJECT_DIR: REPO },
    );
  }

  const denied = [
    ['redirection into the ops board', `echo x > ${OPS}/DISPATCH.md`],
    ['append with no spaces', `echo x>>${OPS}/lanes/carlos.INBOX.md`],
    ['rm of the claims tree', `rm -rf ${STATE}/claims`],
    // S8: forging state wedges the fleet exactly as deleting it does.
    ['mkdir forging a claim', `mkdir -p ${STATE}/claims/b1-portfolio`],
    ['touch forging a heartbeat', `touch ${STATE}/live/b1-portfolio`],
    ['chmod on the seat CLI', `chmod 000 ${STATE}/bin/seat`],
    ['chown on the ops board', `chown node ${OPS}/DISPATCH.md`],
    ['mktemp inside the state root', `mktemp -p ${STATE} scratchXXXX`],
    ['tar extracting into the state root', `tar xf /tmp/a.tar -C ${STATE}`],
    ['tar writing an archive into the state root', `tar -czf ${STATE}/x.tgz .`],
    ['unzip into the state root', `unzip /tmp/a.zip -d ${STATE}`],
    ['zip writing into the state root', `zip -r ${STATE}/x.zip .`],
    // S9: the verb moves to argv[1+] behind an assignment or a wrapper word.
    ['a leading VAR=VALUE assignment', `FOO=1 rm -rf ${STATE}/claims`],
    ['env', `env rm -rf ${STATE}/claims`],
    ['sudo', `sudo rm -rf ${STATE}/claims`],
    ['nohup', `nohup rm -rf ${STATE}/claims`],
    ['timeout with its duration', `timeout 30 rm -rf ${STATE}/claims`],
    ['command', `command rm -rf ${STATE}/claims`],
    ['xargs as the pipe target', `echo x | xargs rm -rf ${STATE}/claims`],
    ['xargs -I with a replacement', `echo a | xargs -I{} mv {} ${STATE}/claims`],
    // S10: the guarded path is never named; the cwd carries it.
    ['cd then a relative redirection', `cd ${OPS} && echo x > DISPATCH.md`],
    ['cd then a relative rm', `cd ${STATE}; rm -rf claims`],
    ['a subshell hiding the cd', `(cd ${OPS} && echo x > DISPATCH.md)`],
    ['a brace group hiding the cd', `{ cd ${STATE}; rm -rf claims; }`],
    // mv UNLINKS its sources: moving guarded state out destroys it as surely
    // as rm does, and the destination arm alone never looked at them.
    ['mv taking the ops board away', `mv ${OPS}/DISPATCH.md /tmp/d.md`],
    // The clone's own perimeter.
    ["rm of this clone's hooks", 'rm -rf .claude/hooks'],
    ['git clean reaching untracked .claude/', 'git clean -fdx'],
    ['git stash -u, which removes untracked files', 'git stash -u'],
    ['git checkout over a guarded path', 'git checkout -- .claude/settings.json'],
  ];
  for (const [name, command] of denied) {
    it(`denies ${name}`, () => expect(verdict(command), command).toBe(2));
  }

  // S11. A guard that denies ordinary work gets turned off, and these were all
  // proven to false-block: a QUOTED redirection operator is an argument, git
  // dry-runs write nothing, and `git stash`/`git reset` cannot touch an
  // untracked file - which after design r4 amendment A is the only guarded
  // thing left inside a worktree (state/ moved out of every clone).
  const allowed = [
    ['a quoted >> in a grep pattern', `grep -n '>>' README.md`],
    ['a quoted >> in an echo', `echo 'a >> b'`],
    ['a heredoc body that looks like a write', `cat <<'EOF' > /tmp/x\necho hi > ${STATE}/f\nEOF`],
    ['git clean --dry-run', 'git clean -nd'],
    ['git clean --dry-run, long form', 'git clean --dry-run -d'],
    ['git stash with no -u/-a', 'git stash'],
    ['git stash push with a message', `git stash push -m 'wip'`],
    ['git reset --hard, which leaves untracked files alone', 'git reset --hard'],
    ['git checkout of a branch', 'git checkout main'],
    ['reading a tar archive', `tar -tzf ${STATE}/x.tgz`],
    ['cp READING a guarded file out', `cp ${OPS}/DISPATCH.md /tmp/d.md`],
    ['a subshell that never enters a guarded root', '(cd /tmp && echo x > y)'],
    ['an ordinary redirection outside the roots', 'echo x > /tmp/scratch.txt'],
    ['an ordinary rm outside the roots', 'rm -rf node_modules/.vite'],
    ['the seat CLI itself', `${CANON_HOST} heartbeat --seat ceremony-agent --quiet`],
  ];
  for (const [name, command] of allowed) {
    it(`allows ${name}`, () => expect(verdict(command), command).toBe(0));
  }
});

// ---------------------------------------------------------------------------
// The fence itself, end to end, against a REAL seat CLI and a THROWAWAY state
// root. Every earlier version of these tests pointed CF_STATE_ROOT at a path
// that does not exist, so the hooks bailed out three lines in and the assertion
// "it exits 0" was true for the wrong reason - the CLI was never reached.
//
// The seat CLI lives in the state root, outside this repo (design r4 amendment
// A), so CI has no copy: these skip there and the CLI's own suite
// (careerforge-state/tests/test_seat.py) covers it. Nothing here can reach the
// live fleet - CF_STATE_ROOT and CF_OPS_ROOT are always temp dirs, and the seat
// name is one no clone uses.
// ---------------------------------------------------------------------------
const SEAT_CLI = [CANON_HOST, CANON_CONTAINER].find((candidate) => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

// The skip above is SILENT by default, which let a whole safety-critical block
// vanish from a green "124 passed" in CI (round-3 finding). So: always announce
// the skip loudly, and let the cutover verification set CF_REQUIRE_SEAT_CLI=1 to
// turn the absence into a hard failure where the CLI is expected to exist.
describe('seat-CLI-backed coverage presence', () => {
  it('is present, or is loudly accounted for', () => {
    if (SEAT_CLI) return;
    const msg =
      'seat CLI not found at either canonical path; the fence/tenure block ' +
      '(B2/B5/S6) is SKIPPED. CI has no copy - state-root suite ' +
      'careerforge-state/tests/test_seat.py is the coverage there.';
    console.warn(`\n[claude-hooks.test] WARNING: ${msg}\n`);
    if (process.env.CF_REQUIRE_SEAT_CLI === '1') {
      throw new Error(`CF_REQUIRE_SEAT_CLI=1 but ${msg}`);
    }
  });
});

describe.skipIf(!SEAT_CLI)('fence and tenure identity (real seat CLI, temp state root)', () => {
  const SEAT_NAME = 'hooktest-seat';
  const OWNER = 'sess-owner-1111-2222';
  const OTHER = 'sess-other-3333-4444';
  let root, ops, clone;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'cf-fence-'));
    root = join(base, 'state');
    ops = join(base, 'ops');
    clone = join(base, 'clone');
    mkdirSync(join(root, 'bin'), { recursive: true });
    mkdirSync(ops, { recursive: true });
    mkdirSync(join(clone, '.claude'), { recursive: true });
    symlinkSync(SEAT_CLI, join(root, 'bin', 'seat'));
    writeFileSync(join(clone, '.claude', 'seat'), `${SEAT_NAME}\n`);
  });
  afterEach(() => rmSync(resolve(root, '..'), { recursive: true, force: true }));

  const env = () => ({ CF_STATE_ROOT: root, CF_OPS_ROOT: ops, CLAUDE_PROJECT_DIR: clone });

  function seat(...args) {
    return spawnSync(SEAT_CLI, args, {
      env: { ...process.env, ...env() },
      encoding: 'utf8',
    });
  }
  function hook(script, payload) {
    return runHook(script, payload, env());
  }
  function fence(session_id, extra = {}) {
    return hook('guard-fence.sh', {
      tool_name: 'Bash',
      session_id,
      cwd: clone,
      tool_input: { command: 'echo hi' },
      ...extra,
    });
  }
  const ownerJson = () => JSON.parse(readFileSync(join(root, 'claims', SEAT_NAME, 'owner.json')));
  const claimExists = () => {
    try {
      accessSync(join(root, 'claims', SEAT_NAME, 'owner.json'), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  };

  it('denies mutating tools on an UNCLAIMED seat, allows reading, allows the claim itself', () => {
    expect(fence(OWNER), 'a Bash call with no claim must be denied').toBe(2);
    expect(
      hook('guard-fence.sh', {
        tool_name: 'Read',
        session_id: OWNER,
        tool_input: { file_path: '/tmp/x' },
      }),
      'reading your way to a claim stays possible',
    ).toBe(0);
    expect(
      fence(OWNER, {
        tool_input: { command: `${SEAT_CLI} claim --seat ${SEAT_NAME} --interactive` },
      }),
      'the fence must not block the claim it tells you to run',
    ).toBe(0);
  });

  it('an interactive claim records no pid and binds on the first tool call', () => {
    expect(
      seat('claim', '--seat', SEAT_NAME, '--interactive', '--init-seat', '--quiet').status,
    ).toBe(0);
    // S12: the only pid an interactive claim could see is the transient shell
    // of its own Bash tool call. Recording it would tell fleetd the harness is
    // dead seconds later.
    expect(ownerJson().pid, 'interactive claims record no pid').toBeNull();
    expect(ownerJson().session_id).toBe('INTERACTIVE');

    // B5: the payload is the only place the real session id exists.
    expect(fence(OWNER)).toBe(0);
    expect(ownerJson().session_id, 'the tenure must bind to the real session').toBe(OWNER);

    // And once bound, a second session in the same clone is a stranger.
    expect(fence(OTHER), 'a second session must not inherit the tenure').toBe(2);
    expect(fence(OWNER), 'the owner keeps working').toBe(0);
  });

  it('a fenced seat denies every tool, including read-only ones', () => {
    expect(
      seat('claim', '--seat', SEAT_NAME, '--interactive', '--init-seat', '--quiet').status,
    ).toBe(0);
    expect(fence(OWNER)).toBe(0);
    writeFileSync(join(root, 'generations', SEAT_NAME), '9\n'); // fleetd reaped it
    expect(fence(OWNER), 'a fenced session must stop, not keep going').toBe(2);
    expect(
      hook('guard-fence.sh', {
        tool_name: 'Read',
        session_id: OWNER,
        tool_input: { file_path: '/tmp/x' },
      }),
      'a fenced session must stop READING too',
    ).toBe(2);
  });

  it('SessionEnd releases the tenure for its owner and for nobody else', () => {
    expect(
      seat('claim', '--seat', SEAT_NAME, '--interactive', '--init-seat', '--quiet').status,
    ).toBe(0);
    expect(fence(OWNER)).toBe(0); // bind

    const stranger = spawnSync(join(HOOKS, 'sessionend-release.sh'), [], {
      input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: OTHER }),
      env: { ...process.env, ...env() },
      encoding: 'utf8',
    });
    expect(stranger.status, 'SessionEnd always exits 0').toBe(0);
    expect(claimExists(), 'a non-owner SessionEnd must NOT release the tenure').toBe(true);

    const owner = spawnSync(join(HOOKS, 'sessionend-release.sh'), [], {
      input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: OWNER }),
      env: { ...process.env, ...env() },
      encoding: 'utf8',
    });
    expect(owner.status).toBe(0);
    expect(claimExists(), "the owner's SessionEnd releases").toBe(false);
  });

  it('an UNBOUND interactive tenure is released by no one (the lease TTL reaps it)', () => {
    expect(
      seat('claim', '--seat', SEAT_NAME, '--interactive', '--init-seat', '--quiet').status,
    ).toBe(0);
    const r = spawnSync(join(HOOKS, 'sessionend-release.sh'), [], {
      input: JSON.stringify({ hook_event_name: 'SessionEnd', session_id: OTHER }),
      env: { ...process.env, ...env() },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(claimExists(), 'a session that never acted cannot prove ownership').toBe(true);
  });

  it('the Stop hook heartbeats a REAL claim, and refuses to fake liveness without an id', () => {
    expect(
      seat('claim', '--seat', SEAT_NAME, '--interactive', '--init-seat', '--quiet').status,
    ).toBe(0);
    expect(fence(OWNER)).toBe(0); // bind
    const live = join(root, 'live', SEAT_NAME);
    const stop = (payload) =>
      spawnSync(join(HOOKS, 'stop-heartbeat.sh'), [], {
        input: payload,
        env: { ...process.env, ...env() },
        encoding: 'utf8',
      });

    // S6: no session_id means this turn cannot be attributed to the holder of
    // the seat, and a heartbeat nobody can be held to is a false liveness
    // signal - fleetd reaps on the ABSENCE of one.
    const before = lstatSync(live).mtimeMs;
    expect(stop(JSON.stringify({ hook_event_name: 'Stop' })).status).toBe(0);
    expect(lstatSync(live).mtimeMs, 'an unattributable turn must not heartbeat').toBe(before);

    // And the real path: a claimed seat, a real id, exit 0, liveness recorded.
    const stamped = spawnSync('touch', ['-t', '202001010101', live]);
    expect(stamped.status).toBe(0);
    const stale = lstatSync(live).mtimeMs;
    expect(stop(JSON.stringify({ hook_event_name: 'Stop', session_id: OWNER })).status).toBe(0);
    expect(lstatSync(live).mtimeMs, "the owner's turn end heartbeats").toBeGreaterThan(stale);
  });

  it('a fenced session cannot re-claim the seat it just lost', () => {
    expect(
      seat('claim', '--seat', SEAT_NAME, '--interactive', '--init-seat', '--quiet').status,
    ).toBe(0);
    expect(fence(OWNER)).toBe(0); // bind, so the archive carries a real identity

    // Exactly what a fleetd reap does: bump the generation, archive the claim.
    writeFileSync(join(root, 'generations', SEAT_NAME), '1\n');
    mkdirSync(join(root, 'claims-archive'), { recursive: true });
    renameSync(
      join(root, 'claims', SEAT_NAME),
      join(root, 'claims-archive', `${SEAT_NAME}.1750000000-sess-own`),
    );

    const again = seat('claim', '--seat', SEAT_NAME, '--interactive', '--session-id', OWNER);
    expect(again.status, 'B2: the reaped session must be refused with FENCED').toBe(4);
    expect(again.stderr).toContain('YOU WERE FENCED');
    expect(claimExists(), 'and it must not have acquired the seat').toBe(false);

    // A FRESH session may take the seat - a reap frees it, it does not burn it.
    expect(seat('claim', '--seat', SEAT_NAME, '--interactive', '--session-id', OTHER).status).toBe(
      0,
    );
  });
});
