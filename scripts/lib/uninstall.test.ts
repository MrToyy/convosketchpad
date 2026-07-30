import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface TestInstallation {
  home: string;
  installRoot: string;
  mockBin: string;
  mockLog: string;
  script: string;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const sourceScript = resolve(process.cwd(), 'uninstall.sh');
let tempRoot = '';

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createInstallation(): TestInstallation {
  const home = join(tempRoot, 'home');
  const installRoot = join(home, 'convosketchpad');
  const mockBin = join(tempRoot, 'mock-bin');
  const mockLog = join(tempRoot, 'commands.log');
  const script = join(installRoot, 'uninstall.sh');

  mkdirSync(join(installRoot, 'database'), { recursive: true });
  mkdirSync(join(installRoot, 'artifacts'), { recursive: true });
  mkdirSync(mockBin, { recursive: true });
  writeFileSync(join(installRoot, 'package.json'), JSON.stringify({
    name: 'convosketchpad',
    version: '0.3.1',
  }));
  writeFileSync(join(installRoot, '.env'), 'CONVOSKETCHPAD_DATA_DIR=/tmp/convosketchpad-state\n');
  writeFileSync(join(installRoot, 'database', 'canvas.sqlite'), 'database');
  writeFileSync(join(installRoot, 'artifacts', 'artifact.txt'), 'artifact');
  copyFileSync(sourceScript, script);
  chmodSync(script, 0o755);

  writeExecutable(join(mockBin, 'uname'), `#!/bin/bash
printf '%s\\n' "\${MOCK_UNAME:-Linux}"
`);
  writeExecutable(join(mockBin, 'sudo'), `#!/bin/bash
printf 'sudo' >> "\${MOCK_LOG}"
printf ' %q' "$@" >> "\${MOCK_LOG}"
printf '\\n' >> "\${MOCK_LOG}"
exec "$@"
`);

  return { home, installRoot, mockBin, mockLog, script };
}

function installLaunchdMocks(installation: TestInstallation): void {
  writeExecutable(join(installation.mockBin, 'plutil'), `#!/bin/bash
case "$2" in
  Label) printf '%s\\n' "\${MOCK_PLIST_LABEL}" ;;
  WorkingDirectory) printf '%s\\n' "\${MOCK_PLIST_WORKING_DIRECTORY}" ;;
  ProgramArguments.0) printf '%s\\n' "\${MOCK_PLIST_PROGRAM}" ;;
  *) exit 1 ;;
esac
`);
  writeExecutable(join(installation.mockBin, 'launchctl'), `#!/bin/bash
if [[ "$1" == "print" ]]; then
  [[ "\${MOCK_LAUNCHD_LOADED:-0}" == "1" ]]
  exit
fi
printf 'launchctl' >> "\${MOCK_LOG}"
printf ' %q' "$@" >> "\${MOCK_LOG}"
printf '\\n' >> "\${MOCK_LOG}"
[[ "\${MOCK_LAUNCHD_FAIL_BOOTOUT:-0}" != "1" ]]
`);
}

function installSystemdMock(installation: TestInstallation): void {
  writeExecutable(join(installation.mockBin, 'systemctl'), `#!/bin/bash
scope=system
if [[ "$1" == "--user" ]]; then
  scope=user
  shift
fi
action="$1"
shift
if [[ "$action" == "show" ]]; then
  if [[ "$scope" == "user" ]]; then
    printf '%s\\n' "\${MOCK_USER_UNIT:-}"
  else
    printf '%s\\n' "\${MOCK_SYSTEM_UNIT:-}"
  fi
  exit 0
fi
if [[ "$action" == "is-active" || "$action" == "is-enabled" ]]; then
  [[ "\${MOCK_SYSTEMD_RUNNING:-1}" == "1" ]]
  exit
fi
printf 'systemctl %s %s' "$scope" "$action" >> "\${MOCK_LOG}"
printf ' %q' "$@" >> "\${MOCK_LOG}"
printf '\\n' >> "\${MOCK_LOG}"
if [[ "$action" == "stop" && "\${MOCK_SYSTEMD_FAIL_STOP:-0}" == "1" ]]; then
  exit 1
fi
exit 0
`);
}

function runUninstall(
  installation: TestInstallation,
  args: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): RunResult {
  const result = spawnSync('bash', [installation.script, ...args], {
    cwd: installation.installRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: installation.home,
      MOCK_LOG: installation.mockLog,
      PATH: `${installation.mockBin}:${process.env.PATH || ''}`,
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function writeUnit(path: string, installRoot: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `[Unit]
Description=ConvoSketchpad

[Service]
WorkingDirectory=${installRoot}
ExecStart=/usr/local/bin/node server-dist/index.js
`);
}

function writeGeneratedWrapper(path: string): void {
  writeFileSync(path, `#!/bin/bash
# ConvoSketchpad start wrapper — .env is loaded by the Node server at runtime.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "\${SCRIPT_DIR}"
export PATH="/usr/local/bin:\${PATH}"
export NODE_ENV=production
exec node "\${SCRIPT_DIR}/server-dist/index.js"
`);
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'convosketchpad-uninstall-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('uninstall.sh', () => {
  it('unregisters a matching launchd service and preserves program data', () => {
    const installation = createInstallation();
    installLaunchdMocks(installation);
    const plist = join(
      installation.home,
      'Library',
      'LaunchAgents',
      'com.mrtoyy.convosketchpad.plist',
    );
    const wrapper = join(installation.installRoot, 'start.sh');
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(plist, '<plist />');
    writeGeneratedWrapper(wrapper);

    const result = runUninstall(installation, [], {
      MOCK_UNAME: 'Darwin',
      MOCK_LAUNCHD_LOADED: '1',
      MOCK_PLIST_LABEL: 'com.mrtoyy.convosketchpad',
      MOCK_PLIST_WORKING_DIRECTORY: installation.installRoot,
      MOCK_PLIST_PROGRAM: wrapper,
    });

    expect(result.status).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(wrapper)).toBe(false);
    expect(existsSync(join(installation.installRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(installation.installRoot, 'database', 'canvas.sqlite'))).toBe(true);
    expect(existsSync(join(installation.installRoot, 'artifacts', 'artifact.txt'))).toBe(true);
    expect(readFileSync(installation.mockLog, 'utf8')).toContain('launchctl bootout');
    expect(result.stdout).toContain('User data was not deleted');
    expect(result.stdout).toContain('rm -rf --');
    expect(result.stdout).toContain('--version v0.3.1 --skip-setup');
    expect(result.stdout).toContain('register and start the managed service again');
  });

  it('performs no launchd mutations during a dry run', () => {
    const installation = createInstallation();
    installLaunchdMocks(installation);
    const plist = join(
      installation.home,
      'Library',
      'LaunchAgents',
      'com.mrtoyy.convosketchpad.plist',
    );
    const wrapper = join(installation.installRoot, 'start.sh');
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(plist, '<plist />');
    writeGeneratedWrapper(wrapper);

    const result = runUninstall(installation, ['--dry-run'], {
      MOCK_UNAME: 'Darwin',
      MOCK_LAUNCHD_LOADED: '1',
      MOCK_PLIST_LABEL: 'com.mrtoyy.convosketchpad',
      MOCK_PLIST_WORKING_DIRECTORY: installation.installRoot,
      MOCK_PLIST_PROGRAM: wrapper,
    });

    expect(result.status).toBe(0);
    expect(existsSync(plist)).toBe(true);
    expect(existsSync(wrapper)).toBe(true);
    expect(existsSync(installation.mockLog)).toBe(false);
    expect(result.stdout).toContain('Would boot out');
    expect(result.stdout).toContain('Dry run complete');
    expect(result.stdout).toContain('--version v0.3.1 --skip-setup');
  });

  it('preserves launchd resources that belong to another installation', () => {
    const installation = createInstallation();
    installLaunchdMocks(installation);
    const plist = join(
      installation.home,
      'Library',
      'LaunchAgents',
      'com.mrtoyy.convosketchpad.plist',
    );
    const wrapper = join(installation.installRoot, 'start.sh');
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(plist, '<plist />');
    writeGeneratedWrapper(wrapper);
    writeFileSync(wrapper, `${readFileSync(wrapper, 'utf8')}echo custom\n`);

    const result = runUninstall(installation, [], {
      MOCK_UNAME: 'Darwin',
      MOCK_LAUNCHD_LOADED: '0',
      MOCK_PLIST_LABEL: 'com.mrtoyy.convosketchpad',
      MOCK_PLIST_WORKING_DIRECTORY: join(installation.home, 'other-install'),
      MOCK_PLIST_PROGRAM: join(installation.home, 'other-install', 'start.sh'),
    });

    expect(result.status).toBe(0);
    expect(existsSync(plist)).toBe(true);
    expect(existsSync(wrapper)).toBe(true);
    expect(result.stderr).toContain('does not belong');
    expect(result.stderr).toContain('does not exactly match the generated wrapper template');
  });

  it('removes matching system and user systemd units', () => {
    const installation = createInstallation();
    installSystemdMock(installation);
    const systemUnit = join(tempRoot, 'system', 'convosketchpad.service');
    const userUnit = join(tempRoot, 'user', 'convosketchpad.service');
    writeUnit(systemUnit, installation.installRoot);
    writeUnit(userUnit, installation.installRoot);

    const result = runUninstall(installation, [], {
      MOCK_UNAME: 'Linux',
      MOCK_SYSTEM_UNIT: systemUnit,
      MOCK_USER_UNIT: userUnit,
    });

    expect(result.status).toBe(0);
    expect(existsSync(systemUnit)).toBe(false);
    expect(existsSync(userUnit)).toBe(false);
    const commands = readFileSync(installation.mockLog, 'utf8');
    expect(commands).toContain('systemctl system stop');
    expect(commands).toContain('systemctl system disable');
    expect(commands).toContain('systemctl user stop');
    expect(commands).toContain('systemctl user disable');
    expect(commands).toContain('daemon-reload');
  });

  it('does not remove a systemd unit when stopping it fails', () => {
    const installation = createInstallation();
    installSystemdMock(installation);
    const systemUnit = join(tempRoot, 'system', 'convosketchpad.service');
    writeUnit(systemUnit, installation.installRoot);

    const result = runUninstall(installation, [], {
      MOCK_UNAME: 'Linux',
      MOCK_SYSTEM_UNIT: systemUnit,
      MOCK_SYSTEMD_FAIL_STOP: '1',
    });

    expect(result.status).toBe(1);
    expect(existsSync(systemUnit)).toBe(true);
    expect(result.stderr).toContain('unit file was preserved');
    expect(result.stderr).toContain('Do not delete the installation directory yet');
    expect(result.stdout).not.toContain('rm -rf --');
  });

  it('is idempotent when no managed service exists', () => {
    const installation = createInstallation();
    installSystemdMock(installation);

    const result = runUninstall(installation, [], {
      MOCK_UNAME: 'Linux',
      MOCK_SYSTEMD_RUNNING: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No matching systemd unit found');
    expect(result.stdout).toContain('No matching managed service resources were present');
    expect(existsSync(join(installation.installRoot, 'database', 'canvas.sqlite'))).toBe(true);
  });

  it('rejects unknown options without changing files', () => {
    const installation = createInstallation();

    const result = runUninstall(installation, ['--purge-data']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown option');
    expect(existsSync(join(installation.installRoot, 'database', 'canvas.sqlite'))).toBe(true);
  });

  it('has valid Bash syntax', () => {
    expect(() => execFileSync('bash', ['-n', sourceScript])).not.toThrow();
  });
});
