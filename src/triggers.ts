import * as github from '@actions/github';
import * as core from '@actions/core';

export interface TriggerContext {
  type: 'heartbeat' | 'issue_comment' | 'issue_created' | 'pull_request' | 'manual';
  description: string;
  data: any;
}

/**
 * Parse the trigger that initiated this workflow
 */
export async function parseTrigger(githubToken: string): Promise<TriggerContext> {
  const context = github.context;
  const octokit = github.getOctokit(githubToken);
  
  core.info(`Event name: ${context.eventName}`);
  core.info(`Action: ${context.payload.action}`);
  
  // Heartbeat (scheduled cron)
  if (context.eventName === 'schedule') {
    return {
      type: 'heartbeat',
      description: 'Scheduled heartbeat check',
      data: {
        repository: context.payload.repository,
        timestamp: new Date().toISOString()
      }
    };
  }
  
  // Issue comment
  if (context.eventName === 'issue_comment' && context.payload.action === 'created') {
    const comment = context.payload.comment;
    const issue = context.payload.issue;
    
    return {
      type: 'issue_comment',
      description: `Comment on ${issue.pull_request ? 'PR' : 'issue'} #${issue.number}`,
      data: {
        issue: {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          isPR: !!issue.pull_request,
          url: issue.html_url,
          author: issue.user.login,
          state: issue.state,
          labels: issue.labels?.map((l: any) => l.name) || []
        },
        comment: {
          id: comment.id,
          body: comment.body,
          author: comment.user.login,
          created_at: comment.created_at,
          url: comment.html_url
        },
        repository: context.payload.repository
      }
    };
  }
  
  // New issue created
  if (context.eventName === 'issues' && context.payload.action === 'opened') {
    const issue = context.payload.issue;
    
    return {
      type: 'issue_created',
      description: `New issue #${issue.number}: ${issue.title}`,
      data: {
        issue: {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          url: issue.html_url,
          author: issue.user.login,
          labels: issue.labels?.map((l: any) => l.name) || []
        },
        repository: context.payload.repository
      }
    };
  }
  
  // Pull request
  if (context.eventName === 'pull_request' && 
      (context.payload.action === 'opened' || context.payload.action === 'synchronize')) {
    const pr = context.payload.pull_request;
    
    // Fetch PR diff/patch
    let diff = '';
    try {
      const { data: prData } = await octokit.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
        mediaType: {
          format: 'diff'
        }
      });
      diff = prData as any as string;
    } catch (error) {
      core.warning(`Failed to fetch PR diff: ${error}`);
    }
    
    return {
      type: 'pull_request',
      description: `PR #${pr.number}: ${pr.title} (${context.payload.action})`,
      data: {
        pr: {
          number: pr.number,
          title: pr.title,
          body: pr.body,
          url: pr.html_url,
          author: pr.user.login,
          state: pr.state,
          branch: pr.head.ref,
          baseBranch: pr.base.ref,
          labels: pr.labels?.map((l: any) => l.name) || [],
          diff: diff.substring(0, 10000) // Limit diff size
        },
        action: context.payload.action,
        repository: context.payload.repository
      }
    };
  }
  
  // Manual trigger
  if (context.eventName === 'workflow_dispatch') {
    return {
      type: 'manual',
      description: 'Manual workflow trigger',
      data: {
        inputs: context.payload.inputs || {},
        repository: context.payload.repository,
        actor: context.actor
      }
    };
  }
  
  // Unknown trigger
  return {
    type: 'manual',
    description: `Unknown trigger: ${context.eventName}`,
    data: {
      eventName: context.eventName,
      payload: context.payload
    }
  };
}
