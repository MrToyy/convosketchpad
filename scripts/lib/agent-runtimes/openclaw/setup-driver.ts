import { confirm, input, password } from '@inquirer/prompts';
import type { EnvConfig } from '../../env-writer.js';
import { DEFAULTS } from '../../env-writer.js';
import { dim, success, warn, promptTheme } from '../../banner.js';
import { isValidUrl } from '../../validators.js';
import type {
  RuntimeSetupCheck,
  RuntimeSetupDetection,
  RuntimeSetupDriver,
} from '../types.js';
import {
  chooseSetupGatewayToken,
  detectGatewayConfig,
  detectOpenClawRuntime,
  getEnvGatewayToken,
  type OpenClawRuntimeDetection,
} from './detect.js';
import { requestGatewayPairing } from './pairing.js';
import { testGatewayConnection } from './connection.js';
import {
  isRemoteGatewayUrl,
  isValidIanaTimezone,
  localIanaTimezone,
} from './timezone.js';

function openClawEnvironment(config: EnvConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(config.OPENCLAW_CONFIG_PATH
      ? { OPENCLAW_CONFIG_PATH: config.OPENCLAW_CONFIG_PATH }
      : {}),
  };
}

function selectedGatewayConfig(
  config: EnvConfig,
  detection: OpenClawRuntimeDetection,
): { token: string | null; url: string | null } {
  if (!detection.detected) return { token: null, url: null };
  return detectGatewayConfig(
    undefined,
    detection.resolvedBinary || detection.command,
    openClawEnvironment(config),
  );
}

function details(detection: RuntimeSetupDetection): OpenClawRuntimeDetection {
  const value = detection.details as OpenClawRuntimeDetection | undefined;
  return value || {
    detected: false,
    command: 'openclaw',
    resolvedBinary: null,
    message: 'OpenClaw was not detected',
  };
}

function validateTimezone(value?: string): void {
  if (value && !isValidIanaTimezone(value)) {
    throw new Error(`Invalid Gateway timezone: ${value}. Use an IANA timezone such as Asia/Shanghai.`);
  }
}

async function configurePairing(config: EnvConfig): Promise<string[]> {
  const gatewayUrl = config.OPENCLAW_GATEWAY_URL || DEFAULTS.OPENCLAW_GATEWAY_URL;
  if (!isRemoteGatewayUrl(gatewayUrl)) {
    success('Local Gateway uses shared-token backend authentication; device pairing is not required.');
    return [];
  }
  const probe = await requestGatewayPairing({
    gatewayUrl,
    gatewayToken: config.OPENCLAW_GATEWAY_TOKEN || '',
  });
  if (probe.status === 'connected') {
    success(probe.message);
    return [];
  }
  if (probe.status !== 'pending') {
    warn(`Could not complete native OpenClaw pairing: ${probe.message}`);
    return ['Start ConvoSketchpad, then approve its request with `openclaw devices list` and `openclaw devices approve <requestId>`.'];
  }
  const requestLabel = probe.requestId || '<requestId>';
  warn(`Native OpenClaw pairing is pending: ${requestLabel}`);
  return [`On the remote Gateway host, verify and approve the ConvoSketchpad backend request: openclaw devices approve ${requestLabel}`];
}

async function verifyGateway(config: EnvConfig): Promise<void> {
  process.stdout.write('  Testing OpenClaw Gateway connection... ');
  const result = await testGatewayConnection(
    config.OPENCLAW_GATEWAY_URL || DEFAULTS.OPENCLAW_GATEWAY_URL,
    config.OPENCLAW_GATEWAY_TOKEN,
  );
  if (!result.ok) {
    console.log(`\x1b[31m✗\x1b[0m ${result.message}`);
    throw new Error('OpenClaw Gateway authentication could not be verified');
  }
  console.log(`\x1b[32m✓\x1b[0m ${result.message}`);
}

export const openClawSetupDriver: RuntimeSetupDriver = {
  id: 'openclaw',
  displayName: 'OpenClaw',
  executableEnvKey: 'OPENCLAW_BIN',

  detect(input) {
    const result = detectOpenClawRuntime({
      configuredBin: input.configuredExecutable,
    });
    return {
      runtimeId: 'openclaw',
      displayName: 'OpenClaw',
      detected: result.detected,
      configured: input.configured,
      message: input.configured ? `${result.message}; existing connection configuration found` : result.message,
      details: result,
    };
  },

  async configureInteractive({ config, existing, detection, args }) {
    const gatewayTimezone = args.options.gatewayTimezone;
    validateTimezone(gatewayTimezone);
    const detected = details(detection);
    const nativeGateway = selectedGatewayConfig(existing, detected);
    if (detected.resolvedBinary) config.OPENCLAW_BIN = detected.resolvedBinary;
    const tokenChoice = chooseSetupGatewayToken({
      existingToken: existing.OPENCLAW_GATEWAY_TOKEN,
      detectedToken: nativeGateway.token,
      envToken: getEnvGatewayToken(),
    });
    const defaultToken = tokenChoice.token || '';
    const defaultUrl = existing.OPENCLAW_GATEWAY_URL
      || process.env.OPENCLAW_GATEWAY_URL
      || nativeGateway.url
      || DEFAULTS.OPENCLAW_GATEWAY_URL;
    if (tokenChoice.source === 'detected') success('Auto-detected Gateway token from OpenClaw CLI');
    if (tokenChoice.source === 'env') success('Found OPENCLAW_GATEWAY_TOKEN in environment');

    config.OPENCLAW_GATEWAY_URL = await input({
      theme: promptTheme,
      message: 'Gateway URL',
      default: defaultUrl,
      validate: (value) => isValidUrl(value) ? true : 'Please enter a valid HTTP(S) URL',
    });
    if (defaultToken && !existing.OPENCLAW_GATEWAY_TOKEN) {
      const useDetected = await confirm({
        theme: promptTheme,
        message: `Use the ${tokenChoice.source === 'env' ? 'environment' : 'detected'} token?`,
        default: true,
      });
      config.OPENCLAW_GATEWAY_TOKEN = useDetected ? defaultToken : await password({
        theme: promptTheme,
        message: 'Gateway Auth Token (required)',
        validate: (value) => value.trim() ? true : 'Gateway token is required',
      });
    } else if (existing.OPENCLAW_GATEWAY_TOKEN) {
      const keepExisting = await confirm({
        theme: promptTheme,
        message: 'Keep the existing Gateway token?',
        default: true,
      });
      config.OPENCLAW_GATEWAY_TOKEN = keepExisting
        ? existing.OPENCLAW_GATEWAY_TOKEN
        : await password({
            theme: promptTheme,
            message: 'Gateway Auth Token (required)',
            validate: (value) => value.trim() ? true : 'Gateway token is required',
          });
    } else {
      dim('Provide the Gateway token explicitly, or inspect it with: openclaw config get gateway.auth.token');
      config.OPENCLAW_GATEWAY_TOKEN = await password({
        theme: promptTheme,
        message: 'Gateway Auth Token (required)',
        validate: (value) => value.trim() ? true : 'Gateway token is required',
      });
    }
    await verifyGateway(config);

    if (gatewayTimezone) config.OPENCLAW_GATEWAY_TIMEZONE = gatewayTimezone;
    if (isRemoteGatewayUrl(config.OPENCLAW_GATEWAY_URL)) {
      dim('Canvas uses the Gateway timezone to predict OpenClaw daily session resets.');
      config.OPENCLAW_GATEWAY_TIMEZONE = (await input({
        theme: promptTheme,
        message: 'Gateway timezone',
        default: gatewayTimezone || existing.OPENCLAW_GATEWAY_TIMEZONE || localIanaTimezone(),
        validate: (value) => isValidIanaTimezone(value)
          ? true
          : 'Enter an IANA timezone such as Asia/Shanghai or America/New_York',
      })).trim();
    }
    return { followUpSteps: await configurePairing(config) };
  },

  async configureDefaults({ config, detection, args }) {
    const gatewayTimezone = args.options.gatewayTimezone;
    validateTimezone(gatewayTimezone);
    const detected = details(detection);
    const nativeGateway = selectedGatewayConfig(config, detected);
    if (detected.resolvedBinary) config.OPENCLAW_BIN = detected.resolvedBinary;
    const environmentToken = getEnvGatewayToken();
    if (environmentToken) {
      config.OPENCLAW_GATEWAY_TOKEN = environmentToken;
      success('Using OPENCLAW_GATEWAY_TOKEN from environment');
    } else if (!config.OPENCLAW_GATEWAY_TOKEN) {
      const tokenChoice = chooseSetupGatewayToken({
        detectedToken: nativeGateway.token,
      });
      if (!tokenChoice.token) {
        throw new Error('OPENCLAW_GATEWAY_TOKEN is required but could not be auto-detected');
      }
      config.OPENCLAW_GATEWAY_TOKEN = tokenChoice.token;
      success(`Auto-detected Gateway token${tokenChoice.source === 'env' ? ' from environment' : ''}`);
    }
    if (process.env.OPENCLAW_GATEWAY_URL) {
      config.OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
    } else {
      config.OPENCLAW_GATEWAY_URL ||= nativeGateway.url || DEFAULTS.OPENCLAW_GATEWAY_URL;
    }
    if (gatewayTimezone) {
      config.OPENCLAW_GATEWAY_TIMEZONE = gatewayTimezone;
    } else if (isRemoteGatewayUrl(config.OPENCLAW_GATEWAY_URL) && !config.OPENCLAW_GATEWAY_TIMEZONE) {
      config.OPENCLAW_GATEWAY_TIMEZONE = localIanaTimezone();
      warn(`Remote Gateway detected; using Gateway timezone ${config.OPENCLAW_GATEWAY_TIMEZONE}`);
    }
    validateTimezone(config.OPENCLAW_GATEWAY_TIMEZONE);
    await verifyGateway(config);
    return { followUpSteps: await configurePairing(config) };
  },

  async check(config): Promise<RuntimeSetupCheck> {
    const successes: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    if (config.OPENCLAW_GATEWAY_TOKEN) successes.push('OPENCLAW_GATEWAY_TOKEN is set');
    else errors.push('OPENCLAW_GATEWAY_TOKEN is missing');
    const url = config.OPENCLAW_GATEWAY_URL || DEFAULTS.OPENCLAW_GATEWAY_URL;
    if (!isValidUrl(url)) {
      errors.push(`OPENCLAW_GATEWAY_URL is invalid: ${url}`);
    } else {
      successes.push(`OPENCLAW_GATEWAY_URL is valid: ${url}`);
      const result = await testGatewayConnection(url, config.OPENCLAW_GATEWAY_TOKEN);
      if (result.ok) successes.push(result.message);
      else errors.push(result.message);
    }
    if (config.OPENCLAW_GATEWAY_TIMEZONE) {
      if (isValidIanaTimezone(config.OPENCLAW_GATEWAY_TIMEZONE)) {
        successes.push(`Gateway timezone is valid: ${config.OPENCLAW_GATEWAY_TIMEZONE}`);
      } else {
        errors.push(`OPENCLAW_GATEWAY_TIMEZONE is invalid: ${config.OPENCLAW_GATEWAY_TIMEZONE}`);
      }
    } else if (isRemoteGatewayUrl(url)) {
      warnings.push(`OPENCLAW_GATEWAY_TIMEZONE is not set; using this host's timezone (${localIanaTimezone()})`);
    }
    return { successes, warnings, errors };
  },

  summary(config) {
    const gatewayUrl = config.OPENCLAW_GATEWAY_URL || DEFAULTS.OPENCLAW_GATEWAY_URL;
    return [
      { label: 'Gateway', value: gatewayUrl },
      ...(config.OPENCLAW_GATEWAY_TIMEZONE
        ? [{ label: 'Gateway TZ', value: config.OPENCLAW_GATEWAY_TIMEZONE }]
        : []),
    ];
  },
};
