import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface GatewayConfig {
  anthropicApiKey: string;
  model: string;
  workspacePath: string;
}

let gatewayProcess: ChildProcess | null = null;

/**
 * Start the OpenClaw Gateway in the background
 */
export async function startGateway(config: GatewayConfig): Promise<void> {
  core.info('Starting OpenClaw Gateway...');
  
  // Write minimal OpenClaw config
  const configDir = path.join(config.workspacePath, '.config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const configPath = path.join(configDir, 'config.json');
  const openclawConfig = {
    providers: {
      anthropic: {
        apiKey: config.anthropicApiKey,
        model: config.model
      }
    },
    channels: {},
    workspace: config.workspacePath
  };
  
  fs.writeFileSync(configPath, JSON.stringify(openclawConfig, null, 2));
  core.info(`Config written to ${configPath}`);
  
  // Start gateway process
  return new Promise((resolve, reject) => {
    gatewayProcess = spawn('openclaw', ['gateway'], {
      cwd: config.workspacePath,
      env: {
        ...process.env,
        OPENCLAW_CONFIG: configPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    gatewayProcess.stdout?.on('data', (data) => {
      core.info(`[Gateway] ${data.toString().trim()}`);
    });
    
    gatewayProcess.stderr?.on('data', (data) => {
      core.info(`[Gateway] ${data.toString().trim()}`);
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
    
    // Give it a moment to start
    setTimeout(() => resolve(), 2000);
  });
}

/**
 * Wait for the Gateway to be ready
 */
export async function waitForReady(timeoutMs: number = 30000): Promise<void> {
  core.info('Waiting for Gateway to be ready...');
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to connect to WebSocket
      const { default: WebSocket } = await import('ws');
      const ws = new WebSocket('ws://localhost:18789');
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.close();
          resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 2000);
      });
      
      core.info('Gateway is ready!');
      return;
      
    } catch (error) {
      // Not ready yet, wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error(`Gateway failed to become ready within ${timeoutMs}ms`);
}

/**
 * Stop the Gateway cleanly
 */
export async function stopGateway(): Promise<void> {
  if (!gatewayProcess) {
    return;
  }
  
  core.info('Stopping Gateway...');
  
  return new Promise((resolve) => {
    if (!gatewayProcess) {
      resolve();
      return;
    }
    
    gatewayProcess.on('exit', () => {
      gatewayProcess = null;
      core.info('Gateway stopped');
      resolve();
    });
    
    // Send SIGTERM
    gatewayProcess.kill('SIGTERM');
    
    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (gatewayProcess) {
        gatewayProcess.kill('SIGKILL');
        gatewayProcess = null;
        resolve();
      }
    }, 5000);
  });
}
