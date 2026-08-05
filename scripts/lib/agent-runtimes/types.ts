import type { SupportedAgentRuntimeId } from '../../../server/lib/agent-runtimes/manifest.js';
import type { EnvConfig } from '../env-writer.js';

export interface RuntimeSetupDetection {
  runtimeId: SupportedAgentRuntimeId;
  displayName: string;
  detected: boolean;
  configured: boolean;
  message: string;
  details?: unknown;
}

export interface RuntimeSetupResult {
  followUpSteps: string[];
}

export interface RuntimeSetupCheck {
  successes: string[];
  warnings: string[];
  errors: string[];
}

export interface RuntimeDiscoveryInput {
  configured: boolean;
  configuredExecutable?: string;
}

export interface RuntimeSetupDriver {
  readonly id: SupportedAgentRuntimeId;
  readonly displayName: string;
  readonly executableEnvKey?: keyof EnvConfig;
  detect(input: RuntimeDiscoveryInput): RuntimeSetupDetection;
  configureInteractive(input: {
    config: EnvConfig;
    existing: EnvConfig;
    detection: RuntimeSetupDetection;
  }): Promise<RuntimeSetupResult>;
  configureDefaults(input: {
    config: EnvConfig;
    detection: RuntimeSetupDetection;
  }): Promise<RuntimeSetupResult>;
  check(config: EnvConfig): Promise<RuntimeSetupCheck>;
  summary(config: EnvConfig): Array<{ label: string; value: string }>;
}
