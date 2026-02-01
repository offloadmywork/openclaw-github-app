import * as github from '@actions/github';
import * as core from '@actions/core';

export interface TriggerContext {
  type: 'heartbeat' | 'issue_comment' | 'issue_created' | 'pull_request' | 'manual';
  message: string;
  issueNumber?: number;
  isPR?: boolean;
}

/**
 * Parse the GitHub event trigger into a message for OpenClaw
 */
export async function parseTrigger(githubToken: string): Promise<TriggerContext> {
  const context = github.context;
  const octokit = github.getOctokit(githubToken);
  
  core.info(`Event: ${context.eventName}, Action: ${context.payload.action}`);
  
  // Schedule (heartbeat)
  if (context.eventName === 'schedule') {
    return {
      type: 'heartbeat',
      message: 'Heartbeat check. Review the repo, look for issues to work on, update memory.'
    };
  }
  
  // Issue comment
  if (context.eventName === 'issue_comment' && context.payload.action === 'created') {
    const comment = context.payload.comment!;
    const issue = context.payload.issue!;
    
    return {
      type: 'issue_comment',
      message: `New comment on ${issue.pull_request ? 'PR' : 'issue'} #${issue.number} by @${comment.user.login}:\n\n${comment.body}\n\n---\n\nIssue title: ${issue.title}\nIssue URL: ${issue.html_url}`,
      issueNumber: issue.number,
      isPR: !!issue.pull_request
    };
  }
  
  // Issue opened or edited
  if (context.eventName === 'issues' && (context.payload.action === 'opened' || context.payload.action === 'edited')) {
    const issue = context.payload.issue!;
    const action = context.payload.action;
    
    return {
      type: 'issue_created',
      message: `Issue #${issue.number} ${action} by @${issue.user.login}: ${issue.title}\n\n${issue.body || '(no description)'}\n\n---\n\nIssue URL: ${issue.html_url}`,
      issueNumber: issue.number,
      isPR: false
    };
  }
  
  // Pull request
  if (context.eventName === 'pull_request' && 
      (context.payload.action === 'opened' || context.payload.action === 'synchronize' || context.payload.action === 'reopened')) {
    const pr = context.payload.pull_request!;
    
    // Fetch files changed
    let filesChanged: string[] = [];
    try {
      const { data: files } = await octokit.rest.pulls.listFiles({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number
      });
      filesChanged = files.map(f => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`);
    } catch (error) {
      core.warning(`Failed to fetch PR files: ${error}`);
    }
    
    const diffSummary = filesChanged.length > 0 
      ? `\n\nFiles changed:\n${filesChanged.slice(0, 20).join('\n')}${filesChanged.length > 20 ? `\n... and ${filesChanged.length - 20} more files` : ''}`
      : '';
    
    return {
      type: 'pull_request',
      message: `PR #${pr.number} by @${pr.user.login}: ${pr.title}\n\n${pr.body || '(no description)'}${diffSummary}\n\n---\n\nPR URL: ${pr.html_url}\nBranch: ${pr.head.ref} → ${pr.base.ref}`,
      issueNumber: pr.number,
      isPR: true
    };
  }
  
  // Pull request review comment
  if (context.eventName === 'pull_request_review_comment' && context.payload.action === 'created') {
    const comment = context.payload.comment!;
    const pr = context.payload.pull_request!;
    
    return {
      type: 'issue_comment',
      message: `New review comment on PR #${pr.number} by @${comment.user.login}:\n\n${comment.body}\n\nFile: ${comment.path}${comment.line ? ` (line ${comment.line})` : ''}\n\n---\n\nPR title: ${pr.title}\nPR URL: ${pr.html_url}`,
      issueNumber: pr.number,
      isPR: true
    };
  }
  
  // Manual trigger
  if (context.eventName === 'workflow_dispatch') {
    return {
      type: 'manual',
      message: 'Manual trigger. Check for anything that needs attention.'
    };
  }
  
  // Unknown trigger
  return {
    type: 'manual',
    message: `Unknown trigger: ${context.eventName}. Please investigate.`
  };
}
