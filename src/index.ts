import * as core from '@actions/core';
import * as github from '@actions/github';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { restoreWorkspace, saveWorkspace } from './workspace';
import { parseTrigger } from './triggers';
import { startGateway, waitForReady, stopGateway } from './gateway';
import { OpenClawClient } from './client';

const execAsync = promisify(exec);

async function run(): Promise<void> {
  let client: OpenClawClient | null = null;
  
  try {
    // Get inputs
    const anthropicApiKey = core.getInput('anthropic_api_key', { required: true });
    const model = core.getInput('model') || 'claude-sonnet-4-20250514';
    const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
    const workspacePath = path.resolve('.openclaw');
    
    core.info('=== OpenClaw GitHub Bot ===');
    core.info(`Model: ${model}`);
    core.info(`Workspace: ${workspacePath}`);
    
    const context = github.context;
    const repo = `${context.repo.owner}/${context.repo.repo}`;
    const sha = context.sha;
    
    // Ensure workspace directory exists
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }
    
    // Install OpenClaw globally
    core.info('Installing OpenClaw...');
    try {
      await execAsync('npm install -g openclaw', { timeout: 120000 });
      core.info('OpenClaw installed successfully');
    } catch (error) {
      core.warning(`OpenClaw installation failed (may already be installed): ${error}`);
      // Continue anyway - it might already be installed
    }
    
    // Verify OpenClaw is available
    try {
      const { stdout } = await execAsync('openclaw --version');
      core.info(`OpenClaw version: ${stdout.trim()}`);
    } catch (error) {
      throw new Error('OpenClaw is not available. Installation may have failed.');
    }
    
    // Restore workspace from cache
    await restoreWorkspace(workspacePath, repo, sha);
    core.info('Workspace restored from cache');
    
    // Start Gateway
    await startGateway({
      anthropicApiKey,
      model,
      workspacePath
    });
    
    // Wait for Gateway to be ready
    await waitForReady();
    
    // Parse trigger
    const trigger = await parseTrigger(githubToken);
    core.info(`Trigger: ${trigger.type}`);
    core.info(`Message: ${trigger.message.substring(0, 200)}...`);
    
    // Connect to Gateway
    client = new OpenClawClient();
    await client.connect();
    
    // Send message and wait for response
    const response = await client.sendMessage(trigger.message);
    
    core.info('Agent response received');
    core.info(`Response length: ${response.length} chars`);
    
    // Disconnect client
    client.disconnect();
    client = null;
    
    // Post response to GitHub if appropriate
    if (trigger.issueNumber && !response.includes('HEARTBEAT_OK')) {
      const octokit = github.getOctokit(githubToken);
      
      try {
        core.info(`Posting response to #${trigger.issueNumber}`);
        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: trigger.issueNumber,
          body: response
        });
        core.info('Response posted successfully');
      } catch (error) {
        core.error(`Failed to post response: ${error}`);
      }
    } else if (response.includes('HEARTBEAT_OK')) {
      core.info('Heartbeat OK - no action needed');
    }
    
    // Stop Gateway
    await stopGateway();
    
    // Save workspace to cache
    await saveWorkspace(workspacePath, repo, sha);
    core.info('Workspace saved to cache');
    
    core.info('=== OpenClaw complete ===');
    
  } catch (error) {
    if (client) {
      client.disconnect();
    }
    
    await stopGateway().catch(() => {});
    
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run();
