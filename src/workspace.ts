import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as fs from 'fs';
import * as path from 'path';

export interface Workspace {
  path: string;
  soul?: string;
  memory?: string;
  dailyLogs: Map<string, string>;
}

/**
 * Restore workspace from GitHub Actions cache
 */
export async function restoreWorkspace(workspacePath: string, repo: string): Promise<Workspace> {
  core.info(`Restoring workspace from cache...`);
  
  // Ensure workspace directory exists
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }
  
  const branch = process.env.GITHUB_REF_NAME || 'main';
  const cacheKey = `openclaw-workspace-${repo}-${branch}`;
  const restoreKeys = [
    `openclaw-workspace-${repo}-`
  ];
  
  try {
    const cacheHit = await cache.restoreCache([workspacePath], cacheKey, restoreKeys);
    if (cacheHit) {
      core.info(`Cache restored from key: ${cacheHit}`);
    } else {
      core.info(`No cache found, starting with fresh workspace`);
      initializeWorkspace(workspacePath);
    }
  } catch (error) {
    core.warning(`Failed to restore cache: ${error}`);
    initializeWorkspace(workspacePath);
  }
  
  return loadWorkspace(workspacePath);
}

/**
 * Initialize a new workspace with default files
 */
function initializeWorkspace(workspacePath: string): void {
  const soulPath = path.join(workspacePath, 'SOUL.md');
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  const memoryDir = path.join(workspacePath, 'memory');
  
  if (!fs.existsSync(soulPath)) {
    fs.writeFileSync(soulPath, `# SOUL.md - Who Am I?

I am an OpenClaw GitHub bot, running inside GitHub Actions.

## Purpose
I help maintain this repository by:
- Responding to issues and pull requests
- Providing context and assistance
- Keeping track of what's happening

## Personality
I am helpful, concise, and focused on getting things done.

## Response Guidelines — CRITICAL

**NEVER show internal reasoning or thinking steps in your responses.**

When responding to issues or PRs:
- Give **clean, direct, helpful answers only**
- No "Let me check...", "I can see...", "I'll try to..." narration
- No describing what you're about to do — just do it and report results
- Format responses in clean GitHub markdown
- Be concise and to the point
- If you need to investigate, do it silently and present only findings

**Example BAD response:**
> "I can see the comment from @user! Let me check the GitHub issue to understand the context better. I can see that the web fetch returned... Let me try to check if there's a GitHub CLI available..."

**Example GOOD response:**
> "Based on the issue discussion, here's what I found: [direct answer]. The relevant code is in \`file.ts\` lines 42-58."

Remember: Users see your final response as a GitHub comment. Make it clean, professional, and valuable.
`);
  }
  
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, `# MEMORY.md - Long-Term Memory

This is my curated memory of important events, decisions, and learnings.
`);
  }
  
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
}

/**
 * Load workspace files into memory
 */
function loadWorkspace(workspacePath: string): Workspace {
  const soulPath = path.join(workspacePath, 'SOUL.md');
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  const memoryDir = path.join(workspacePath, 'memory');
  
  const workspace: Workspace = {
    path: workspacePath,
    dailyLogs: new Map()
  };
  
  if (fs.existsSync(soulPath)) {
    workspace.soul = fs.readFileSync(soulPath, 'utf-8');
  }
  
  if (fs.existsSync(memoryPath)) {
    workspace.memory = fs.readFileSync(memoryPath, 'utf-8');
  }
  
  // Load recent daily logs (last 7 days)
  if (fs.existsSync(memoryDir)) {
    const files = fs.readdirSync(memoryDir);
    const logFiles = files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
    
    // Sort descending and take last 7
    logFiles.sort().reverse().slice(0, 7).forEach(file => {
      const date = file.replace('.md', '');
      const content = fs.readFileSync(path.join(memoryDir, file), 'utf-8');
      workspace.dailyLogs.set(date, content);
    });
  }
  
  return workspace;
}

/**
 * Save workspace back to cache
 */
export async function saveWorkspace(workspacePath: string, repo: string): Promise<void> {
  core.info(`Saving workspace to cache...`);
  
  const branch = process.env.GITHUB_REF_NAME || 'main';
  const cacheKey = `openclaw-workspace-${repo}-${branch}`;
  
  try {
    await cache.saveCache([workspacePath], cacheKey);
    core.info(`Workspace cached with key: ${cacheKey}`);
  } catch (error) {
    core.warning(`Failed to save cache: ${error}`);
  }
}

/**
 * Write to daily log
 */
export function writeDailyLog(workspacePath: string, content: string): void {
  const memoryDir = path.join(workspacePath, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  
  const today = new Date().toISOString().split('T')[0];
  const logPath = path.join(memoryDir, `${today}.md`);
  
  const timestamp = new Date().toISOString();
  const entry = `\n## ${timestamp}\n\n${content}\n`;
  
  fs.appendFileSync(logPath, entry);
}

/**
 * Update MEMORY.md
 */
export function updateMemory(workspacePath: string, content: string): void {
  const memoryPath = path.join(workspacePath, 'MEMORY.md');
  fs.appendFileSync(memoryPath, `\n${content}\n`);
}
