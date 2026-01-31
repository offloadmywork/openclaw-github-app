import Anthropic from '@anthropic-ai/sdk';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { Workspace, writeDailyLog, updateMemory } from './workspace';
import { TriggerContext } from './triggers';

export interface AgentConfig {
  anthropicApiKey: string;
  model: string;
  githubToken: string;
}

/**
 * Run the AI agent
 */
export async function runAgent(
  workspace: Workspace,
  trigger: TriggerContext,
  config: AgentConfig
): Promise<void> {
  core.info(`Running agent for trigger: ${trigger.type}`);
  
  const anthropic = new Anthropic({
    apiKey: config.anthropicApiKey
  });
  
  // Build the prompt
  const prompt = buildPrompt(workspace, trigger);
  
  core.info(`Calling Claude API with model: ${config.model}`);
  core.info(`Prompt length: ${prompt.length} characters`);
  
  try {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }
    
    const agentResponse = content.text;
    core.info(`Agent response received (${agentResponse.length} chars)`);
    
    // Log to daily log
    writeDailyLog(workspace.path, `### ${trigger.description}\n\n**Trigger:** ${trigger.type}\n\n**Response:**\n${agentResponse}`);
    
    // Execute actions based on the response
    await executeActions(agentResponse, trigger, config.githubToken);
    
  } catch (error) {
    core.error(`Agent execution failed: ${error}`);
    writeDailyLog(workspace.path, `### ERROR: ${trigger.description}\n\n${error}`);
    throw error;
  }
}

/**
 * Build the prompt for the AI agent
 */
function buildPrompt(workspace: Workspace, trigger: TriggerContext): string {
  const sections: string[] = [];
  
  // SOUL.md
  if (workspace.soul) {
    sections.push(`# WHO YOU ARE\n\n${workspace.soul}`);
  }
  
  // MEMORY.md
  if (workspace.memory) {
    sections.push(`# YOUR MEMORY\n\n${workspace.memory}`);
  }
  
  // Recent daily logs
  if (workspace.dailyLogs.size > 0) {
    const logs = Array.from(workspace.dailyLogs.entries())
      .map(([date, content]) => `## ${date}\n${content}`)
      .join('\n\n');
    sections.push(`# RECENT ACTIVITY\n\n${logs}`);
  }
  
  // Trigger context
  sections.push(`# CURRENT TRIGGER\n\n**Type:** ${trigger.type}\n**Description:** ${trigger.description}\n\n**Context:**\n\`\`\`json\n${JSON.stringify(trigger.data, null, 2)}\n\`\`\``);
  
  // Instructions
  sections.push(`# INSTRUCTIONS

You are an AI bot running inside a GitHub Actions workflow. You have been triggered by: ${trigger.description}

Based on the trigger type, you should:

**For heartbeat:** Check if there's anything that needs attention. Reply with "HEARTBEAT_OK" if nothing to do, or suggest actions.

**For issue_comment:** Read the comment and respond helpfully. If the comment mentions you or asks a question, provide a thoughtful response.

**For issue_created:** Welcome the user and provide any relevant guidance. Check if the issue is clear and well-formed.

**For pull_request:** Review the PR description and diff. Provide helpful feedback or acknowledgment.

**For manual:** Perform any requested actions.

## Your Capabilities

You can suggest actions in your response using this format:

**COMMENT:** [issue/PR number] [your comment text]
**UPDATE_MEMORY:** [content to add to MEMORY.md]
**COMMIT:** [file path] [content]

Keep responses concise and helpful. You are a supportive team member, not a gatekeeper.

## Your Response

Provide your response now:`);
  
  return sections.join('\n\n---\n\n');
}

/**
 * Parse and execute actions from the agent response
 */
async function executeActions(response: string, trigger: TriggerContext, githubToken: string): Promise<void> {
  const octokit = github.getOctokit(githubToken);
  const context = github.context;
  
  // Parse COMMENT: actions
  const commentMatches = response.matchAll(/\*\*COMMENT:\*\*\s+(\d+)\s+(.+?)(?=\n\*\*|$)/gs);
  for (const match of commentMatches) {
    const issueNumber = parseInt(match[1]);
    const commentBody = match[2].trim();
    
    try {
      core.info(`Posting comment to #${issueNumber}`);
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        body: commentBody
      });
      core.info(`Comment posted successfully`);
    } catch (error) {
      core.error(`Failed to post comment: ${error}`);
    }
  }
  
  // Parse UPDATE_MEMORY: actions
  const memoryMatches = response.matchAll(/\*\*UPDATE_MEMORY:\*\*\s+(.+?)(?=\n\*\*|$)/gs);
  for (const match of memoryMatches) {
    const memoryContent = match[1].trim();
    core.info(`Updating MEMORY.md`);
    updateMemory(context.workspace || '.', memoryContent);
  }
  
  // If this is an issue comment or new issue, and no explicit COMMENT action,
  // post the response as a comment
  if ((trigger.type === 'issue_comment' || trigger.type === 'issue_created') && 
      !response.includes('**COMMENT:**') &&
      !response.includes('HEARTBEAT_OK')) {
    
    const issueNumber = trigger.data.issue?.number || trigger.data.comment?.issue_number;
    if (issueNumber) {
      try {
        core.info(`Posting agent response to #${issueNumber}`);
        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          body: response
        });
      } catch (error) {
        core.error(`Failed to post response: ${error}`);
      }
    }
  }
}
