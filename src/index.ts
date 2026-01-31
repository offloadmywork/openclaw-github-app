import * as core from '@actions/core';
import * as github from '@actions/github';
import { restoreWorkspace, saveWorkspace } from './workspace';
import { parseTrigger } from './triggers';
import { runAgent } from './agent';

async function run(): Promise<void> {
  try {
    // Get inputs
    const anthropicApiKey = core.getInput('anthropic_api_key', { required: true });
    const model = core.getInput('model') || 'claude-sonnet-4-20250514';
    const workspacePath = core.getInput('workspace_path') || '.openclaw';
    const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
    
    core.info('=== OpenClaw GitHub App ===');
    core.info(`Model: ${model}`);
    core.info(`Workspace: ${workspacePath}`);
    
    const context = github.context;
    const repo = `${context.repo.owner}/${context.repo.repo}`;
    const sha = context.sha;
    
    // Restore workspace from cache
    const workspace = await restoreWorkspace(workspacePath, repo, sha);
    core.info(`Workspace loaded (${workspace.dailyLogs.size} recent logs)`);
    
    // Parse trigger
    const trigger = await parseTrigger(githubToken);
    core.info(`Trigger: ${trigger.type} - ${trigger.description}`);
    
    // Run agent
    await runAgent(workspace, trigger, {
      anthropicApiKey,
      model,
      githubToken
    });
    
    // Save workspace to cache
    await saveWorkspace(workspacePath, repo, sha);
    
    core.info('=== OpenClaw complete ===');
    
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run();
