import * as github from '@actions/github';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface OpenClawConfig {
  systemPrompt?: string;
  context?: {
    includeReadme?: boolean;
    readmeMaxChars?: number;
    recentCommits?: number;
    openIssues?: boolean;
    maxIssues?: number;
  };
}

export interface RepoContext {
  readme?: string;
  recentCommits?: string[];
  openIssues?: Array<{ number: number; title: string; labels: string[] }>;
  config?: OpenClawConfig;
}

const DEFAULT_CONFIG: OpenClawConfig = {
  context: {
    includeReadme: true,
    readmeMaxChars: 4000,
    recentCommits: 10,
    openIssues: true,
    maxIssues: 15,
  }
};

/**
 * Load .openclaw.yml config from repo root or .github/
 */
export function loadConfig(): OpenClawConfig {
  const configPaths = [
    '.openclaw.yml',
    '.openclaw.yaml',
    '.github/openclaw.yml',
    '.github/openclaw.yaml',
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = yaml.load(content) as OpenClawConfig;
        core.info(`Loaded config from ${configPath}`);
        return { ...DEFAULT_CONFIG, ...config, context: { ...DEFAULT_CONFIG.context, ...config?.context } };
      } catch (error) {
        core.warning(`Failed to parse ${configPath}: ${error}`);
      }
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Fetch README.md content (truncated if needed)
 */
export async function fetchReadme(octokit: ReturnType<typeof github.getOctokit>, owner: string, repo: string, maxChars: number = 4000): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getReadme({
      owner,
      repo,
      mediaType: { format: 'raw' }
    });

    let content = typeof data === 'string' ? data : String(data);

    if (content.length > maxChars) {
      content = content.substring(0, maxChars) + '\n\n... (README truncated)';
    }

    return content;
  } catch (error) {
    core.debug(`Failed to fetch README: ${error}`);
    return undefined;
  }
}

/**
 * Fetch recent commits
 */
export async function fetchRecentCommits(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  count: number = 10
): Promise<string[]> {
  try {
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: count,
    });

    return commits.map(c => {
      const sha = c.sha.substring(0, 7);
      const msg = c.commit.message.split('\n')[0].substring(0, 80);
      const author = c.commit.author?.name || c.author?.login || 'unknown';
      return `${sha} ${msg} (${author})`;
    });
  } catch (error) {
    core.debug(`Failed to fetch commits: ${error}`);
    return [];
  }
}

/**
 * Fetch open issues (excluding PRs)
 */
export async function fetchOpenIssues(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  maxIssues: number = 15
): Promise<Array<{ number: number; title: string; labels: string[] }>> {
  try {
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: maxIssues,
      sort: 'updated',
      direction: 'desc',
    });

    // Filter out PRs (issues API includes PRs)
    return issues
      .filter(i => !i.pull_request)
      .map(i => ({
        number: i.number,
        title: i.title,
        labels: i.labels.map(l => (typeof l === 'string' ? l : l.name || '')).filter(Boolean),
      }));
  } catch (error) {
    core.debug(`Failed to fetch issues: ${error}`);
    return [];
  }
}

/**
 * Build the full repo context
 */
export async function buildRepoContext(githubToken: string): Promise<RepoContext> {
  const context = github.context;
  const octokit = github.getOctokit(githubToken);
  const { owner, repo } = context.repo;

  const config = loadConfig();
  const contextConfig = config.context || DEFAULT_CONFIG.context!;

  const repoContext: RepoContext = { config };

  // Fetch README
  if (contextConfig.includeReadme) {
    repoContext.readme = await fetchReadme(octokit, owner, repo, contextConfig.readmeMaxChars);
  }

  // Fetch recent commits
  if (contextConfig.recentCommits && contextConfig.recentCommits > 0) {
    repoContext.recentCommits = await fetchRecentCommits(octokit, owner, repo, contextConfig.recentCommits);
  }

  // Fetch open issues
  if (contextConfig.openIssues) {
    repoContext.openIssues = await fetchOpenIssues(octokit, owner, repo, contextConfig.maxIssues);
  }

  return repoContext;
}

/**
 * Format repo context as a string for the system prompt
 */
export function formatContextForPrompt(repoContext: RepoContext): string {
  const parts: string[] = [];

  // Custom system prompt from config
  if (repoContext.config?.systemPrompt) {
    parts.push(`## Custom Instructions\n\n${repoContext.config.systemPrompt}`);
  }

  // README
  if (repoContext.readme) {
    parts.push(`## README\n\n${repoContext.readme}`);
  }

  // Recent commits
  if (repoContext.recentCommits && repoContext.recentCommits.length > 0) {
    parts.push(`## Recent Commits\n\n${repoContext.recentCommits.map(c => `- ${c}`).join('\n')}`);
  }

  // Open issues
  if (repoContext.openIssues && repoContext.openIssues.length > 0) {
    const issueLines = repoContext.openIssues.map(i => {
      const labels = i.labels.length > 0 ? ` [${i.labels.join(', ')}]` : '';
      return `- #${i.number}: ${i.title}${labels}`;
    });
    parts.push(`## Open Issues\n\n${issueLines.join('\n')}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `# Repository Context\n\n${parts.join('\n\n---\n\n')}`;
}

/**
 * Build and format full context string
 */
export async function getFormattedContext(githubToken: string): Promise<string> {
  const repoContext = await buildRepoContext(githubToken);
  return formatContextForPrompt(repoContext);
}
