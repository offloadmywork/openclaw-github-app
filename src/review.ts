import * as github from '@actions/github';
import * as core from '@actions/core';

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface ParsedReview {
  summary: string;
  comments: ReviewComment[];
  verdict: 'approve' | 'request_changes' | 'comment';
}

/**
 * Fetch the full diff for a PR
 */
export async function fetchPRDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  maxChars: number = 50000
): Promise<string> {
  try {
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' }
    });

    let diff = typeof data === 'string' ? data : String(data);

    if (diff.length > maxChars) {
      diff = diff.substring(0, maxChars) + '\n\n... (diff truncated)';
    }

    return diff;
  } catch (error) {
    core.warning(`Failed to fetch PR diff: ${error}`);
    return '';
  }
}

/**
 * Fetch file patches with line mapping info
 */
export async function fetchPRFiles(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<Array<{ filename: string; patch?: string; status: string }>> {
  try {
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100
    });

    return files.map(f => ({
      filename: f.filename,
      patch: f.patch,
      status: f.status
    }));
  } catch (error) {
    core.warning(`Failed to fetch PR files: ${error}`);
    return [];
  }
}

/**
 * Parse agent response to extract structured review
 * 
 * Expected format:
 * ---
 * VERDICT: approve | request_changes | comment
 * ---
 * 
 * ## Summary
 * Overall review summary...
 * 
 * ## Comments
 * 
 * ### FILE: path/to/file.ts LINE: 42
 * Comment about this specific line...
 * 
 * ### FILE: another/file.js LINE: 15
 * Another comment...
 */
export function parseReviewResponse(response: string): ParsedReview {
  const result: ParsedReview = {
    summary: '',
    comments: [],
    verdict: 'comment'
  };

  // Extract verdict
  const verdictMatch = response.match(/VERDICT:\s*(approve|request_changes|comment)/i);
  if (verdictMatch) {
    result.verdict = verdictMatch[1].toLowerCase() as ParsedReview['verdict'];
  }

  // Extract summary
  const summaryMatch = response.match(/## Summary\s*\n([\s\S]*?)(?=\n## Comments|\n### FILE:|$)/i);
  if (summaryMatch) {
    result.summary = summaryMatch[1].trim();
  } else {
    // If no structured format, use the whole response as summary
    result.summary = response.replace(/---\s*VERDICT:.*?---/is, '').trim();
  }

  // Extract inline comments
  const commentPattern = /### FILE:\s*(\S+)\s+LINE:\s*(\d+)\s*\n([\s\S]*?)(?=\n### FILE:|$)/gi;
  let match;
  while ((match = commentPattern.exec(response)) !== null) {
    const [, path, lineStr, body] = match;
    const line = parseInt(lineStr, 10);
    if (path && !isNaN(line) && body.trim()) {
      result.comments.push({
        path: path.trim(),
        line,
        body: body.trim()
      });
    }
  }

  return result;
}

/**
 * Map a line number to the diff position for inline comments
 * GitHub requires the "position" in the diff, not the actual line number
 */
export function findDiffPosition(
  patch: string | undefined,
  targetLine: number
): number | null {
  if (!patch) return null;

  const lines = patch.split('\n');
  let diffPosition = 0;
  let currentLine = 0;

  for (const line of lines) {
    diffPosition++;

    // Parse hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    // Skip removed lines (they don't exist in the new file)
    if (line.startsWith('-')) {
      continue;
    }

    // Context or added lines
    if (line.startsWith('+') || line.startsWith(' ') || !line.startsWith('\\')) {
      currentLine++;
      if (currentLine === targetLine) {
        return diffPosition;
      }
    }
  }

  return null;
}

/**
 * Post a PR review with optional inline comments
 */
export async function postPRReview(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  review: ParsedReview,
  files: Array<{ filename: string; patch?: string }>
): Promise<void> {
  // Build file lookup for position mapping
  const fileMap = new Map(files.map(f => [f.filename, f.patch]));

  // Convert comments to GitHub format with positions
  const reviewComments: Array<{
    path: string;
    position?: number;
    line?: number;
    body: string;
  }> = [];

  for (const comment of review.comments) {
    const patch = fileMap.get(comment.path);
    const position = findDiffPosition(patch, comment.line);

    if (position !== null) {
      reviewComments.push({
        path: comment.path,
        position,
        body: comment.body
      });
    } else {
      // Fallback: add to summary if we can't map the position
      review.summary += `\n\n**${comment.path}:${comment.line}**\n${comment.body}`;
    }
  }

  // Map verdict to GitHub's event type
  const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
    approve: 'APPROVE',
    request_changes: 'REQUEST_CHANGES',
    comment: 'COMMENT'
  };

  const event = eventMap[review.verdict] || 'COMMENT';

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      body: `🤖 **OpenClaw Bot Review**\n\n${review.summary}`,
      event,
      comments: reviewComments.length > 0 ? reviewComments : undefined
    });

    core.info(`Posted PR review: ${event} with ${reviewComments.length} inline comments`);
  } catch (error) {
    core.error(`Failed to post PR review: ${error}`);
    throw error;
  }
}

/**
 * Build review instructions for the agent
 */
export function getReviewInstructions(): string {
  return `
## PR Review Instructions

You are reviewing a pull request. Analyze the diff carefully and provide a structured review.

**Your response MUST follow this exact format:**

\`\`\`
---
VERDICT: comment
---

## Summary

[Your overall assessment of the PR. Be constructive and specific.]

## Comments

### FILE: path/to/file.ts LINE: 42
[Specific feedback about this line. Explain the issue and suggest a fix.]

### FILE: another/file.js LINE: 15
[Another inline comment...]
\`\`\`

**VERDICT options:**
- \`approve\` — The PR is good to merge
- \`request_changes\` — Changes are required before merging
- \`comment\` — Just providing feedback, no approval/rejection

**Guidelines:**
- Focus on bugs, security issues, and significant improvements
- Be specific — reference actual code from the diff
- Suggest concrete fixes, not vague advice
- Keep comments concise and actionable
- Don't nitpick style unless it's a real problem
- If the PR looks good, say so briefly and approve

**Important:** Your inline comments (### FILE: ... LINE: ...) will be posted as GitHub review comments directly on those lines.
`;
}
