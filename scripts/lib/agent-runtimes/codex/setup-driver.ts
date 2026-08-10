import type { RuntimeSetupDriver } from '../types.js';
import { success, warn } from '../../banner.js';
import {
  agentRuntimeWorkspaceDirectory,
  ensureAgentRuntimeWorkspace,
  validateAgentRuntimeWorkspace,
} from '../workspace.js';
import { detectCodexRuntime, probeCodexAccount, type CodexRuntimeDetection } from './detect.js';
import { MINIMUM_CODEX_VERSION } from '../../../../server/lib/agent-runtimes/adapters/codex/setup-support.js';

function details(value: unknown): CodexRuntimeDetection {
  return value as CodexRuntimeDetection;
}

async function probe(binary: string, workingDirectory: string): Promise<string[]> {
  const result = await probeCodexAccount({ binary, workingDirectory });
  if (!result.connected) {
    warn(`Codex App Server could not be verified: ${result.message}`);
    return ['Fix the Codex App Server error, then re-run `npm run setup`.'];
  }
  if (!result.loggedIn) {
    warn('Codex is not logged in. ConvoSketchpad setup will continue.');
    return ['Run `codex login`, then re-run `npm run setup` to verify Codex.'];
  }
  success(result.message);
  return [];
}

export const codexSetupDriver: RuntimeSetupDriver = {
  id: 'codex',
  displayName: 'Codex',
  executableEnvKey: 'CODEX_BIN',

  detect(input) {
    const result = detectCodexRuntime({ configuredBin: input.configuredExecutable });
    return {
      runtimeId: 'codex',
      displayName: 'Codex',
      detected: result.detected,
      configured: input.configured,
      message: input.configured ? `${result.message}; existing connection configuration found` : result.message,
      details: result,
    };
  },

  async configureInteractive({ config, detection }) {
    const detected = details(detection.details);
    if (detected.resolvedBinary) config.CODEX_BIN = detected.resolvedBinary;
    if (detected.detected && !detected.supported) {
      warn(`Codex ${detected.version || 'version unknown'} is below the supported minimum ${MINIMUM_CODEX_VERSION}.`);
    }
    const workingDirectory = ensureAgentRuntimeWorkspace();
    return { followUpSteps: await probe(config.CODEX_BIN || detected.command, workingDirectory) };
  },

  async configureDefaults({ config, detection }) {
    const detected = details(detection.details);
    if (detected.resolvedBinary) config.CODEX_BIN = detected.resolvedBinary;
    const workingDirectory = ensureAgentRuntimeWorkspace();
    return { followUpSteps: await probe(config.CODEX_BIN || detected.command, workingDirectory) };
  },

  async check(config) {
    const successes: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const detection = detectCodexRuntime({ configuredBin: config.CODEX_BIN });
    if (!detection.detected) errors.push(detection.message);
    else if (!detection.supported) errors.push(detection.message);
    else successes.push(detection.message);
    const workingDirectory = agentRuntimeWorkspaceDirectory();
    const workspaceValidation = validateAgentRuntimeWorkspace(workingDirectory);
    if (workspaceValidation === true) {
      successes.push(`Agent Runtime workspace: ${workingDirectory}`);
    } else errors.push(workspaceValidation);
    if (errors.length === 0) {
      const account = await probeCodexAccount({
        binary: config.CODEX_BIN || detection.command,
        workingDirectory,
      });
      if (!account.connected) errors.push(account.message);
      else if (!account.loggedIn) warnings.push('Codex is not logged in; run `codex login` and re-run setup');
      else successes.push(account.message);
    }
    return { successes, warnings, errors };
  },

  summary(config) {
    return [
      { label: 'Codex', value: config.CODEX_BIN || 'codex' },
      { label: 'Codex cwd', value: agentRuntimeWorkspaceDirectory() },
    ];
  },
};
