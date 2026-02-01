import * as core from '@actions/core';
import * as github from '@actions/github';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { restoreWorkspace, saveWorkspace } from './workspace';
import { parseTrigger } from './triggers';
import { startGateway, waitForReady, stopGateway, resolveModel } from './gateway';
import { OpenClawClient } from './client';

const execAsync = promisify(exec);

async function run(): Promise<void> {
  let client: OpenClawClient | null = null;

  try {
    // Get inputs — provider-agnostic
    const apiKey = core.getInput('api_key', { required: true });
    const provider = core.getInput('provider') || 'anthropic';
    const model = core.getInput('model') || '';
    const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
    const workspacePath = path.resolve('.openclaw');

    const resolvedModel = resolveModel(provider, model);
    core.info('=== OpenClaw GitHub Bot ===');
    core.info(`Provider: ${provider}`);
    core.info(`Model: ${resolvedModel}`);
    core.info(`Workspace: ${workspacePath}`);

    const context = github.context;
    const repo = `${context.repo.owner}/${context.repo.repo}`;

    fs.mkdirSync(workspacePath, { recursive: true });

    // Install OpenClaw
    core.info('Installing OpenClaw...');
    try {
      await execAsync('npm install -g openclaw', { timeout: 120000 });
      core.info('OpenClaw installed successfully');
    } catch (error) {
      core.warning(`OpenClaw install issue (may already exist): ${error}`);
    }

    // Fix PATH — npm global bin may not be in PATH on GitHub Actions
    try {
      const { stdout: npmPrefix } = await execAsync('npm config get prefix');
      const binDir = path.join(npmPrefix.trim(), 'bin');
      if (binDir && !process.env.PATH?.includes(binDir)) {
        process.env.PATH = `${binDir}:${process.env.PATH}`;
        core.info(`Added ${binDir} to PATH`);
      }
    } catch (e) {
      core.warning(`Could not determine npm prefix: ${e}`);
    }

    // Debug: check what was installed
    try {
      const { stdout: whichResult } = await execAsync('which openclaw || echo "not found"');
      core.info(`which openclaw: ${whichResult.trim()}`);
      const { stdout: lsResult } = await execAsync('ls -la $(npm config get prefix)/lib/node_modules/openclaw/package.json 2>/dev/null || echo "package not found"');
      core.info(`openclaw package: ${lsResult.trim()}`);
      const { stdout: binCheck } = await execAsync('cat $(npm config get prefix)/lib/node_modules/openclaw/package.json 2>/dev/null | node -e "const d=require(\'fs\').readFileSync(\'/dev/stdin\',\'utf8\');const p=JSON.parse(d);console.log(JSON.stringify(p.bin||\'no bin\'))" || echo "no package.json"');
      core.info(`openclaw bin entry: ${binCheck.trim()}`);
    } catch (e) {
      core.info(`Debug check failed: ${e}`);
    }

    try {
      const { stdout } = await execAsync('openclaw --version');
      core.info(`OpenClaw version: ${stdout.trim()}`);
    } catch {
      // Fallback: try npx
      try {
        const { stdout } = await execAsync('npx openclaw --version', { timeout: 30000 });
        core.info(`OpenClaw version (via npx): ${stdout.trim()}`);
      } catch (e) {
        throw new Error(`OpenClaw is not available. Installation may have failed. Error: ${e}`);
      }
    }

    // Restore workspace from cache
    await restoreWorkspace(workspacePath, repo);

    // Start Gateway
    await startGateway({ provider, apiKey, model, workspacePath });
    await waitForReady();

    // Parse trigger
    const trigger = await parseTrigger(githubToken);
    core.info(`Trigger: ${trigger.type}`);
    core.info(`Message: ${trigger.message.substring(0, 200)}...`);

    // Connect and send message
    client = new OpenClawClient();
    await client.connect();
    const response = await client.sendMessage(trigger.message);
    core.info(`Response: ${response.length} chars`);
    client.disconnect();
    client = null;

    // Post response to GitHub
    if (trigger.issueNumber && !response.includes('HEARTBEAT_OK')) {
      const octokit = github.getOctokit(githubToken);
      try {
        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: trigger.issueNumber,
          body: response
        });
        core.info(`Posted to #${trigger.issueNumber}`);
      } catch (error) {
        core.error(`Failed to post: ${error}`);
      }
    } else if (response.includes('HEARTBEAT_OK')) {
      core.info('Heartbeat OK — no action needed');
    } else {
      core.info('No issue/PR to post to — response logged above');
    }

    await stopGateway();
    await saveWorkspace(workspacePath, repo);
    core.info('=== OpenClaw complete ===');

  } catch (error) {
    if (client) client.disconnect();
    await stopGateway().catch(() => {});
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
