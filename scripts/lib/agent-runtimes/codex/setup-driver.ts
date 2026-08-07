import { input } from '@inquirer/prompts';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { RuntimeSetupDriver } from '../types.js';
import { dim, success, warn, promptTheme } from '../../banner.js';
import { detectCodexRuntime, probeCodexAccount, type CodexRuntimeDetection } from './detect.js';
import { MINIMUM_CODEX_VERSION } from '../../../../server/lib/agent-runtimes/adapters/codex/setup-support.js';

export const DEFAULT_CODEX_WORKING_DIRECTORY = '~/codex-convosketchpad';

export function codexWorkingDirectoryPromptDefault(existing?: string): string {
  return existing?.trim() || DEFAULT_CODEX_WORKING_DIRECTORY;
}

export function normalizeCodexWorkingDirectory(value: string): string {
  const candidate = value.trim();
  if (candidate === '~') return os.homedir();
  if (candidate.startsWith('~/')) return join(os.homedir(), candidate.slice(2));
  return candidate;
}

function details(value: unknown): CodexRuntimeDetection {
  return value as CodexRuntimeDetection;
}

function validDirectory(value: string): true | string {
  const candidate = normalizeCodexWorkingDirectory(value);
  if (!candidate) return 'A Codex working directory is required';
  if (!isAbsolute(candidate)) return 'Use an absolute working-directory path';
  try {
    const codeHome = resolve(process.env.CODEX_HOME || join(os.homedir(), '.codex'));
    const realCodeHome = existsSync(codeHome) ? realpathSync(codeHome) : codeHome;
    const comparableCandidate = existsSync(candidate) ? realpathSync(candidate) : resolve(candidate);
    const relativeToCodeHome = relative(realCodeHome, comparableCandidate);
    if (relativeToCodeHome === '' || (!relativeToCodeHome.startsWith('..') && !isAbsolute(relativeToCodeHome))) {
      return 'CODEX_HOME (~/.codex) and its contents cannot be used as the Codex working directory';
    }
    if (existsSync(candidate) && !statSync(candidate).isDirectory()) return 'The path is not a directory';
  } catch {
    return 'The directory cannot be inspected';
  }
  return true;
}

export function ensureCodexWorkingDirectory(value: string): string {
  const candidate = normalizeCodexWorkingDirectory(value);
  const validation = validDirectory(candidate);
  if (validation !== true) throw new Error(validation);
  mkdirSync(candidate, { recursive: true, mode: 0o700 });
  const createdValidation = validDirectory(candidate);
  if (createdValidation !== true) throw new Error(createdValidation);
  return candidate;
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

  async configureInteractive({ config, existing, detection }) {
    const detected = details(detection.details);
    if (detected.resolvedBinary) config.CODEX_BIN = detected.resolvedBinary;
    if (detected.detected && !detected.supported) {
      warn(`Codex ${detected.version || 'version unknown'} is below the supported minimum ${MINIMUM_CODEX_VERSION}.`);
    }
    dim('This is the project directory Codex may read and modify. It is not ~/.codex.');
    const selectedWorkingDirectory = await input({
      theme: promptTheme,
      message: 'Codex working directory',
      default: codexWorkingDirectoryPromptDefault(existing.CODEX_WORKING_DIRECTORY),
      validate: validDirectory,
    });
    config.CODEX_WORKING_DIRECTORY = ensureCodexWorkingDirectory(selectedWorkingDirectory);
    return { followUpSteps: await probe(config.CODEX_BIN || detected.command, config.CODEX_WORKING_DIRECTORY) };
  },

  async configureDefaults({ config, detection }) {
    const detected = details(detection.details);
    if (detected.resolvedBinary) config.CODEX_BIN = detected.resolvedBinary;
    config.CODEX_WORKING_DIRECTORY = ensureCodexWorkingDirectory(
      config.CODEX_WORKING_DIRECTORY
      || process.env.CODEX_WORKING_DIRECTORY
      || DEFAULT_CODEX_WORKING_DIRECTORY,
    );
    return { followUpSteps: await probe(config.CODEX_BIN || detected.command, config.CODEX_WORKING_DIRECTORY!) };
  },

  async check(config) {
    const successes: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const detection = detectCodexRuntime({ configuredBin: config.CODEX_BIN });
    if (!detection.detected) errors.push(detection.message);
    else if (!detection.supported) errors.push(detection.message);
    else successes.push(detection.message);
    const validation = validDirectory(config.CODEX_WORKING_DIRECTORY || '');
    if (validation !== true) errors.push(`CODEX_WORKING_DIRECTORY: ${validation}`);
    else successes.push(`Codex working directory: ${config.CODEX_WORKING_DIRECTORY}`);
    if (errors.length === 0) {
      const account = await probeCodexAccount({
        binary: config.CODEX_BIN || detection.command,
        workingDirectory: config.CODEX_WORKING_DIRECTORY!,
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
      { label: 'Codex cwd', value: config.CODEX_WORKING_DIRECTORY || 'not configured' },
    ];
  },
};
