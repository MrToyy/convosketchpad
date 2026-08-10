import type { RuntimeSetupDriver } from '../types.js';
import { success, warn } from '../../banner.js';
import {
  agentRuntimeWorkspaceDirectory,
  ensureAgentRuntimeWorkspace,
  validateAgentRuntimeWorkspace,
} from '../workspace.js';
import { detectOpenCodeRuntime, probeOpenCodeServer, type OpenCodeRuntimeDetection } from './detect.js';
import {
  MINIMUM_OPENCODE_VERSION,
} from '../../../../server/lib/agent-runtimes/adapters/opencode/setup-support.js';

function details(value: unknown): OpenCodeRuntimeDetection { return value as OpenCodeRuntimeDetection; }

async function probe(binary: string, workingDirectory: string): Promise<string[]> {
  const result = await probeOpenCodeServer({ binary, workingDirectory });
  if (!result.connected) {
    warn(`OpenCode Server could not be verified: ${result.message}`);
    return ['Fix the OpenCode Server error, then re-run `npm run setup`.'];
  }
  success(result.message);
  return [];
}

export const openCodeSetupDriver: RuntimeSetupDriver = {
  id: 'opencode',
  displayName: 'OpenCode',
  executableEnvKey: 'OPENCODE_BIN',

  detect(input) {
    const result = detectOpenCodeRuntime({ configuredBin: input.configuredExecutable });
    return {
      runtimeId: 'opencode', displayName: 'OpenCode', detected: result.detected, configured: input.configured,
      message: input.configured ? `${result.message}; existing connection configuration found` : result.message,
      details: result,
    };
  },

  async configureInteractive({ config, detection }) {
    const detected = details(detection.details);
    if (detected.resolvedBinary) config.OPENCODE_BIN = detected.resolvedBinary;
    if (detected.detected && !detected.supported) warn(`OpenCode ${detected.version || 'version unknown'} is below the supported minimum ${MINIMUM_OPENCODE_VERSION}.`);
    const workingDirectory = ensureAgentRuntimeWorkspace();
    return { followUpSteps: await probe(config.OPENCODE_BIN || detected.command, workingDirectory) };
  },

  async configureDefaults({ config, detection }) {
    const detected = details(detection.details);
    if (detected.resolvedBinary) config.OPENCODE_BIN = detected.resolvedBinary;
    const workingDirectory = ensureAgentRuntimeWorkspace();
    return { followUpSteps: await probe(config.OPENCODE_BIN || detected.command, workingDirectory) };
  },

  async check(config) {
    const successes: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const detection = detectOpenCodeRuntime({ configuredBin: config.OPENCODE_BIN });
    if (!detection.detected || !detection.supported) errors.push(detection.message);
    else successes.push(detection.message);
    const workingDirectory = agentRuntimeWorkspaceDirectory();
    const workspaceValidation = validateAgentRuntimeWorkspace(workingDirectory);
    if (workspaceValidation === true) {
      successes.push(`Agent Runtime workspace: ${workingDirectory}`);
    } else errors.push(workspaceValidation);
    if (errors.length === 0) {
      const result = await probeOpenCodeServer({
        binary: config.OPENCODE_BIN || detection.command,
        workingDirectory,
      });
      if (result.connected) successes.push(result.message); else errors.push(result.message);
    }
    return { successes, warnings, errors };
  },

  summary(config) {
    return [
      { label: 'OpenCode', value: config.OPENCODE_BIN || 'opencode' },
      { label: 'OpenCode cwd', value: agentRuntimeWorkspaceDirectory() },
    ];
  },
};
