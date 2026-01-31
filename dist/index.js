"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var core4 = __toESM(require("@actions/core"));
var github3 = __toESM(require("@actions/github"));

// src/workspace.ts
var core = __toESM(require("@actions/core"));
var cache = __toESM(require("@actions/cache"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
async function restoreWorkspace(workspacePath, repo, sha) {
  core.info(`Restoring workspace from cache...`);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }
  const cacheKey = `openclaw-workspace-${repo}-${sha}`;
  const restoreKeys = [
    `openclaw-workspace-${repo}-`,
    `openclaw-workspace-`
  ];
  try {
    const cacheHit = await cache.restoreCache([workspacePath], cacheKey, restoreKeys);
    if (cacheHit) {
      core.info(`Cache restored from key: ${cacheHit}`);
    } else {
      core.info(`No cache found, starting with fresh workspace`);
      initializeWorkspace(workspacePath);
    }
  } catch (error2) {
    core.warning(`Failed to restore cache: ${error2}`);
    initializeWorkspace(workspacePath);
  }
  return loadWorkspace(workspacePath);
}
function initializeWorkspace(workspacePath) {
  const soulPath = path.join(workspacePath, "SOUL.md");
  const memoryPath = path.join(workspacePath, "MEMORY.md");
  const memoryDir = path.join(workspacePath, "memory");
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
function loadWorkspace(workspacePath) {
  const soulPath = path.join(workspacePath, "SOUL.md");
  const memoryPath = path.join(workspacePath, "MEMORY.md");
  const memoryDir = path.join(workspacePath, "memory");
  const workspace = {
    path: workspacePath,
    dailyLogs: /* @__PURE__ */ new Map()
  };
  if (fs.existsSync(soulPath)) {
    workspace.soul = fs.readFileSync(soulPath, "utf-8");
  }
  if (fs.existsSync(memoryPath)) {
    workspace.memory = fs.readFileSync(memoryPath, "utf-8");
  }
  if (fs.existsSync(memoryDir)) {
    const files = fs.readdirSync(memoryDir);
    const logFiles = files.filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
    logFiles.sort().reverse().slice(0, 7).forEach((file) => {
      const date = file.replace(".md", "");
      const content = fs.readFileSync(path.join(memoryDir, file), "utf-8");
      workspace.dailyLogs.set(date, content);
    });
  }
  return workspace;
}
async function saveWorkspace(workspacePath, repo, sha) {
  core.info(`Saving workspace to cache...`);
  const cacheKey = `openclaw-workspace-${repo}-${sha}`;
  try {
    await cache.saveCache([workspacePath], cacheKey);
    core.info(`Workspace cached with key: ${cacheKey}`);
  } catch (error2) {
    core.warning(`Failed to save cache: ${error2}`);
  }
}
function writeDailyLog(workspacePath, content) {
  const memoryDir = path.join(workspacePath, "memory");
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const logPath = path.join(memoryDir, `${today}.md`);
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const entry = `
## ${timestamp}

${content}
`;
  fs.appendFileSync(logPath, entry);
}
function updateMemory(workspacePath, content) {
  const memoryPath = path.join(workspacePath, "MEMORY.md");
  fs.appendFileSync(memoryPath, `
${content}
`);
}

// src/triggers.ts
var github = __toESM(require("@actions/github"));
var core2 = __toESM(require("@actions/core"));
async function parseTrigger(githubToken) {
  const context4 = github.context;
  const octokit = github.getOctokit(githubToken);
  core2.info(`Event name: ${context4.eventName}`);
  core2.info(`Action: ${context4.payload.action}`);
  if (context4.eventName === "schedule") {
    return {
      type: "heartbeat",
      description: "Scheduled heartbeat check",
      data: {
        repository: context4.payload.repository,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  if (context4.eventName === "issue_comment" && context4.payload.action === "created") {
    const comment = context4.payload.comment;
    const issue = context4.payload.issue;
    return {
      type: "issue_comment",
      description: `Comment on ${issue.pull_request ? "PR" : "issue"} #${issue.number}`,
      data: {
        issue: {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          isPR: !!issue.pull_request,
          url: issue.html_url,
          author: issue.user.login,
          state: issue.state,
          labels: issue.labels?.map((l) => l.name) || []
        },
        comment: {
          id: comment.id,
          body: comment.body,
          author: comment.user.login,
          created_at: comment.created_at,
          url: comment.html_url
        },
        repository: context4.payload.repository
      }
    };
  }
  if (context4.eventName === "issues" && context4.payload.action === "opened") {
    const issue = context4.payload.issue;
    return {
      type: "issue_created",
      description: `New issue #${issue.number}: ${issue.title}`,
      data: {
        issue: {
          number: issue.number,
          title: issue.title,
          body: issue.body,
          url: issue.html_url,
          author: issue.user.login,
          labels: issue.labels?.map((l) => l.name) || []
        },
        repository: context4.payload.repository
      }
    };
  }
  if (context4.eventName === "pull_request" && (context4.payload.action === "opened" || context4.payload.action === "synchronize")) {
    const pr = context4.payload.pull_request;
    let diff = "";
    try {
      const { data: prData } = await octokit.rest.pulls.get({
        owner: context4.repo.owner,
        repo: context4.repo.repo,
        pull_number: pr.number,
        mediaType: {
          format: "diff"
        }
      });
      diff = prData;
    } catch (error2) {
      core2.warning(`Failed to fetch PR diff: ${error2}`);
    }
    return {
      type: "pull_request",
      description: `PR #${pr.number}: ${pr.title} (${context4.payload.action})`,
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
          labels: pr.labels?.map((l) => l.name) || [],
          diff: diff.substring(0, 1e4)
          // Limit diff size
        },
        action: context4.payload.action,
        repository: context4.payload.repository
      }
    };
  }
  if (context4.eventName === "workflow_dispatch") {
    return {
      type: "manual",
      description: "Manual workflow trigger",
      data: {
        inputs: context4.payload.inputs || {},
        repository: context4.payload.repository,
        actor: context4.actor
      }
    };
  }
  return {
    type: "manual",
    description: `Unknown trigger: ${context4.eventName}`,
    data: {
      eventName: context4.eventName,
      payload: context4.payload
    }
  };
}

// src/agent.ts
var import_sdk = __toESM(require("@anthropic-ai/sdk"));
var core3 = __toESM(require("@actions/core"));
var github2 = __toESM(require("@actions/github"));
async function runAgent(workspace, trigger, config) {
  core3.info(`Running agent for trigger: ${trigger.type}`);
  const anthropic = new import_sdk.default({
    apiKey: config.anthropicApiKey
  });
  const prompt = buildPrompt(workspace, trigger);
  core3.info(`Calling Claude API with model: ${config.model}`);
  core3.info(`Prompt length: ${prompt.length} characters`);
  try {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: prompt
      }]
    });
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }
    const agentResponse = content.text;
    core3.info(`Agent response received (${agentResponse.length} chars)`);
    writeDailyLog(workspace.path, `### ${trigger.description}

**Trigger:** ${trigger.type}

**Response:**
${agentResponse}`);
    await executeActions(agentResponse, trigger, config.githubToken);
  } catch (error2) {
    core3.error(`Agent execution failed: ${error2}`);
    writeDailyLog(workspace.path, `### ERROR: ${trigger.description}

${error2}`);
    throw error2;
  }
}
function buildPrompt(workspace, trigger) {
  const sections = [];
  if (workspace.soul) {
    sections.push(`# WHO YOU ARE

${workspace.soul}`);
  }
  if (workspace.memory) {
    sections.push(`# YOUR MEMORY

${workspace.memory}`);
  }
  if (workspace.dailyLogs.size > 0) {
    const logs = Array.from(workspace.dailyLogs.entries()).map(([date, content]) => `## ${date}
${content}`).join("\n\n");
    sections.push(`# RECENT ACTIVITY

${logs}`);
  }
  sections.push(`# CURRENT TRIGGER

**Type:** ${trigger.type}
**Description:** ${trigger.description}

**Context:**
\`\`\`json
${JSON.stringify(trigger.data, null, 2)}
\`\`\``);
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
  return sections.join("\n\n---\n\n");
}
async function executeActions(response, trigger, githubToken) {
  const octokit = github2.getOctokit(githubToken);
  const context4 = github2.context;
  const commentMatches = response.matchAll(/\*\*COMMENT:\*\*\s+(\d+)\s+(.+?)(?=\n\*\*|$)/gs);
  for (const match of commentMatches) {
    const issueNumber = parseInt(match[1]);
    const commentBody = match[2].trim();
    try {
      core3.info(`Posting comment to #${issueNumber}`);
      await octokit.rest.issues.createComment({
        owner: context4.repo.owner,
        repo: context4.repo.repo,
        issue_number: issueNumber,
        body: commentBody
      });
      core3.info(`Comment posted successfully`);
    } catch (error2) {
      core3.error(`Failed to post comment: ${error2}`);
    }
  }
  const memoryMatches = response.matchAll(/\*\*UPDATE_MEMORY:\*\*\s+(.+?)(?=\n\*\*|$)/gs);
  for (const match of memoryMatches) {
    const memoryContent = match[1].trim();
    core3.info(`Updating MEMORY.md`);
    updateMemory(context4.workspace || ".", memoryContent);
  }
  if ((trigger.type === "issue_comment" || trigger.type === "issue_created") && !response.includes("**COMMENT:**") && !response.includes("HEARTBEAT_OK")) {
    const issueNumber = trigger.data.issue?.number || trigger.data.comment?.issue_number;
    if (issueNumber) {
      try {
        core3.info(`Posting agent response to #${issueNumber}`);
        await octokit.rest.issues.createComment({
          owner: context4.repo.owner,
          repo: context4.repo.repo,
          issue_number: issueNumber,
          body: response
        });
      } catch (error2) {
        core3.error(`Failed to post response: ${error2}`);
      }
    }
  }
}

// src/index.ts
async function run() {
  try {
    const anthropicApiKey = core4.getInput("anthropic_api_key", { required: true });
    const model = core4.getInput("model") || "claude-sonnet-4-20250514";
    const workspacePath = core4.getInput("workspace_path") || ".openclaw";
    const githubToken = core4.getInput("github_token") || process.env.GITHUB_TOKEN || "";
    core4.info("=== OpenClaw GitHub App ===");
    core4.info(`Model: ${model}`);
    core4.info(`Workspace: ${workspacePath}`);
    const context4 = github3.context;
    const repo = `${context4.repo.owner}/${context4.repo.repo}`;
    const sha = context4.sha;
    const workspace = await restoreWorkspace(workspacePath, repo, sha);
    core4.info(`Workspace loaded (${workspace.dailyLogs.size} recent logs)`);
    const trigger = await parseTrigger(githubToken);
    core4.info(`Trigger: ${trigger.type} - ${trigger.description}`);
    await runAgent(workspace, trigger, {
      anthropicApiKey,
      model,
      githubToken
    });
    await saveWorkspace(workspacePath, repo, sha);
    core4.info("=== OpenClaw complete ===");
  } catch (error2) {
    if (error2 instanceof Error) {
      core4.setFailed(error2.message);
    } else {
      core4.setFailed("An unknown error occurred");
    }
  }
}
run();
