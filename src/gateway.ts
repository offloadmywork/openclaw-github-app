import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface GatewayConfig {
  provider: string;
  apiKey: string;
  model: string;
  workspacePath: string;
}

// Map provider names to their expected env var
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  xai: 'XAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

// Default models per provider
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'anthropic/claude-sonnet-4-5',
  xai: 'xai/grok-3-fast',
  openai: 'openai/gpt-4.1-mini',
  google: 'google/gemini-2.5-flash',
  groq: 'groq/llama-3.3-70b-versatile',
  openrouter: 'openrouter/anthropic/claude-sonnet-4-5',
};

let gatewayProcess: ChildProcess | null = null;

export function resolveModel(provider: string, model: string): string {
  if (model) {
    // If model already has provider prefix, use as-is
    if (model.includes('/')) return model;
    // Otherwise, add provider prefix
    return `${provider}/${model}`;
  }
  return DEFAULT_MODELS[provider] || `${provider}/default`;
}

export async function startGateway(config: GatewayConfig): Promise<void> {
  core.info('Starting OpenClaw Gateway...');

  // Write minimal OpenClaw config to ~/.openclaw/openclaw.json
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const configDir = path.join(homeDir, '.openclaw');
  fs.mkdirSync(configDir, { recursive: true });

  const resolvedModel = resolveModel(config.provider, config.model);
  
  // Generate a random gateway token for local auth
  const gatewayToken = require('crypto').randomBytes(16).toString('hex');
  
  // Build provider config for non-built-in providers that need baseUrl
  const PROVIDER_BASE_URLS: Record<string, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    cerebras: 'https://api.cerebras.ai/v1',
    groq: 'https://api.groq.com/openai/v1',
    sambanova: 'https://api.sambanova.ai/v1',
  };

  const providersConfig: Record<string, any> = {};
  const baseUrl = PROVIDER_BASE_URLS[config.provider];
  if (baseUrl) {
    providersConfig[config.provider] = {
      api: 'openai-chat',
      baseUrl,
      models: [{ id: resolvedModel.replace(`${config.provider}/`, ''), contextWindow: 131072, maxTokens: 32768 }]
    };
  }

  const openclawConfig: Record<string, any> = {
    agents: {
      defaults: {
        model: { primary: resolvedModel },
        workspace: config.workspacePath
      }
    },
    channels: {}
  };

  if (Object.keys(providersConfig).length > 0) {
    openclawConfig.models = { providers: providersConfig };
  }
  
  // Export token so client can use it
  (globalThis as any).__openclawGatewayToken = gatewayToken;

  const configPath = path.join(configDir, 'openclaw.json');
  fs.writeFileSync(configPath, JSON.stringify(openclawConfig, null, 2));
  core.info(`Config: provider=${config.provider}, model=${resolvedModel}`);
  core.info(`Config path: ${configPath}, workspace: ${config.workspacePath}`);

  // Set the provider's API key env var
  const envKey = PROVIDER_ENV_MAP[config.provider] || `${config.provider.toUpperCase()}_API_KEY`;
  
  const env = {
    ...process.env,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    [envKey]: config.apiKey,
  };

  return new Promise((resolve, reject) => {
    gatewayProcess = spawn('openclaw', ['gateway', '--allow-unconfigured'], {
      cwd: homeDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    gatewayProcess.stdout?.on('data', (data) => {
      core.info(`[Gateway] ${data.toString().trim()}`);
    });

    gatewayProcess.stderr?.on('data', (data) => {
      core.error(`[Gateway] ${data.toString().trim()}`);
    });

    gatewayProcess.on('error', (error) => {
      core.error(`Gateway process error: ${error}`);
      reject(error);
    });

    gatewayProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        core.warning(`Gateway exited with code ${code}`);
      }
    });

    setTimeout(() => resolve(), 2000);
  });
}

export async function waitForReady(timeoutMs: number = 30000): Promise<void> {
  core.info('Waiting for Gateway to be ready...');

  const startTime = Date.now();
  const token = (globalThis as any).__openclawGatewayToken || '';
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const { default: WebSocket } = await import('ws');
      const wsUrl = token ? `ws://localhost:18789?token=${token}` : 'ws://localhost:18789';
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 2000);
      });

      core.info('Gateway is ready!');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Gateway failed to become ready within ${timeoutMs}ms`);
}

export async function stopGateway(): Promise<void> {
  if (!gatewayProcess) return;

  core.info('Stopping Gateway...');
  return new Promise((resolve) => {
    if (!gatewayProcess) { resolve(); return; }

    gatewayProcess.on('exit', () => {
      gatewayProcess = null;
      core.info('Gateway stopped');
      resolve();
    });

    gatewayProcess.kill('SIGTERM');
    setTimeout(() => {
      if (gatewayProcess) {
        gatewayProcess.kill('SIGKILL');
        gatewayProcess = null;
        resolve();
      }
    }, 5000);
  });
}
