import * as github from '@actions/github';
import * as core from '@actions/core';
import { getFormattedContext } from './context';
import { fetchPRDiff, fetchPRFiles, getReviewInstructions } from './review';

export interface TriggerContext {
  type: 'heartbeat' | 'issue_comment' | 'issue_created' | 'pull_request' | 'manual';
  message: string;
  repoContext?: string;
  issueNumber?: number;
  isPR?: boolean;
  // PR review specific
  prFiles?: Array<{ filename: string; patch?: string; status: string }>;
}

/**
 * Parse the GitHub event trigger into a message for OpenClaw
 */
export async function parseTrigger(githubToken: string): Promise<TriggerContext> {
  const context = github.context;
  const octokit = github.getOctokit(githubToken);
  
  core.info(`Event: ${context.eventName}, Action: ${context.payload.action}`);

  // Build repo context (README, commits, issues, config)
  core.info('Building repository context...');
  let repoContext = '';
  try {
    repoContext = await getFormattedContext(githubToken);
    if (repoContext) {
      core.info(`Context built: ${repoContext.length} chars`);
    }
  } catch (error) {
    core.warning(`Failed to build repo context: ${error}`);
  }
  
  // Schedule (heartbeat)
  if (context.eventName === 'schedule') {
    const message = repoContext
      ? `${repoContext}\n\n---\n\nHeartbeat check. Review the repo, look for issues to work on, update memory.`
      : 'Heartbeat check. Review the repo, look for issues to work on, update memory.';
    return {
      type: 'heartbeat',
      message,
      repoContext
    };
  }
  
  // Issue comment
  if (context.eventName === 'issue_comment' && context.payload.action === 'created') {
    const comment = context.payload.comment!;
    const issue = context.payload.issue!;
    
    const eventMessage = `New comment on ${issue.pull_request ? 'PR' : 'issue'} #${issue.number} by @${comment.user.login}:\n\n${comment.body}\n\n---\n\nIssue title: ${issue.title}\nIssue URL: ${issue.html_url}`;
    const message = repoContext ? `${repoContext}\n\n---\n\n${eventMessage}` : eventMessage;
    
    return {
      type: 'issue_comment',
      message,
      repoContext,
      issueNumber: issue.number,
      isPR: !!issue.pull_request
    };
  }
  
  // Issue opened or edited
  if (context.eventName === 'issues' && (context.payload.action === 'opened' || context.payload.action === 'edited')) {
    const issue = context.payload.issue!;
    const action = context.payload.action;
    
    const eventMessage = `Issue #${issue.number} ${action} by @${issue.user.login}: ${issue.title}\n\n${issue.body || '(no description)'}\n\n---\n\nIssue URL: ${issue.html_url}`;
    const message = repoContext ? `${repoContext}\n\n---\n\n${eventMessage}` : eventMessage;
    
    return {
      type: 'issue_created',
      message,
      repoContext,
      issueNumber: issue.number,
      isPR: false
    };
  }
  
  // Pull request
  if (context.eventName === 'pull_request' && 
      (context.payload.action === 'opened' || context.payload.action === 'synchronize' || context.payload.action === 'reopened')) {
    const pr = context.payload.pull_request!;
    const { owner, repo } = context.repo;
    
    // Fetch full diff for review
    core.info('Fetching PR diff for review...');
    const diff = await fetchPRDiff(octokit, owner, repo, pr.number);
    const prFiles = await fetchPRFiles(octokit, owner, repo, pr.number);
    
    core.info(`Fetched diff: ${diff.length} chars, ${prFiles.length} files`);
    
    // Build file summary
    const filesSummary = prFiles.length > 0 
      ? `\n\nFiles changed (${prFiles.length}):\n${prFiles.slice(0, 20).map(f => `- ${f.status}: ${f.filename}`).join('\n')}${prFiles.length > 20 ? `\n... and ${prFiles.length - 20} more files` : ''}`
      : '';
    
    // Build the review prompt with diff
    const reviewInstructions = getReviewInstructions();
    const prInfo = `PR #${pr.number} by @${pr.user.login}: ${pr.title}\n\n${pr.body || '(no description)'}${filesSummary}\n\nPR URL: ${pr.html_url}\nBranch: ${pr.head.ref} → ${pr.base.ref}`;
    
    const diffSection = diff ? `\n\n## Diff\n\n\`\`\`diff\n${diff}\n\`\`\`` : '';
    
    const eventMessage = `${reviewInstructions}\n\n---\n\n## Pull Request\n\n${prInfo}${diffSection}`;
    const message = repoContext ? `${repoContext}\n\n---\n\n${eventMessage}` : eventMessage;
    
    return {
      type: 'pull_request',
      message,
      repoContext,
      issueNumber: pr.number,
      isPR: true,
      prFiles
    };
  }
  
  // Pull request review comment
  if (context.eventName === 'pull_request_review_comment' && context.payload.action === 'created') {
    const comment = context.payload.comment!;
    const pr = context.payload.pull_request!;
    
    const eventMessage = `New review comment on PR #${pr.number} by @${comment.user.login}:\n\n${comment.body}\n\nFile: ${comment.path}${comment.line ? ` (line ${comment.line})` : ''}\n\n---\n\nPR title: ${pr.title}\nPR URL: ${pr.html_url}`;
    const message = repoContext ? `${repoContext}\n\n---\n\n${eventMessage}` : eventMessage;
    
    return {
      type: 'issue_comment',
      message,
      repoContext,
      issueNumber: pr.number,
      isPR: true
    };
  }
  
  // Manual trigger
  if (context.eventName === 'workflow_dispatch') {
    const eventMessage = 'Manual trigger. Check for anything that needs attention.';
    const message = repoContext ? `${repoContext}\n\n---\n\n${eventMessage}` : eventMessage;
    return {
      type: 'manual',
      message,
      repoContext
    };
  }
  
  // Unknown trigger
  const eventMessage = `Unknown trigger: ${context.eventName}. Please investigate.`;
  const message = repoContext ? `${repoContext}\n\n---\n\n${eventMessage}` : eventMessage;
  return {
    type: 'manual',
    message,
    repoContext
  };
}
