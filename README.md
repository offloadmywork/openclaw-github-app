# OpenClaw GitHub App

An AI-powered GitHub bot that runs entirely on GitHub Actions — no hosted service required.

## 🧠 Concept

OpenClaw is a GitHub bot powered by Claude (Anthropic) that lives inside your repository's GitHub Actions. It:

- **Responds to issues and PRs** - Helpful comments, code review, suggestions
- **Runs on a heartbeat** - Proactive checks via cron schedules
- **Has memory** - Persistent state stored in GitHub Actions cache
- **Learns over time** - Builds context from daily logs and long-term memory

Unlike traditional GitHub Apps that require hosting, OpenClaw runs directly in your CI/CD pipeline using GitHub's infrastructure.

## 🏗️ Architecture

```
Trigger (issue, PR, cron, etc.)
    ↓
GitHub Actions Workflow
    ↓
Restore workspace from cache (SOUL.md, MEMORY.md, daily logs)
    ↓
Parse trigger context
    ↓
Call Claude API with full context
    ↓
Execute actions (comment, commit, etc.)
    ↓
Save workspace to cache
```

### Workspace Structure

The workspace is a directory (`.openclaw/`) containing:

```
.openclaw/
├── SOUL.md          # Bot's identity and purpose
├── MEMORY.md        # Long-term curated memory
└── memory/
    ├── 2024-01-15.md
    ├── 2024-01-16.md
    └── ...          # Daily activity logs
```

This workspace is cached between runs using GitHub Actions cache, giving the bot continuity.

## 🚀 Setup

### 1. Add to your repository

Create `.github/workflows/openclaw.yml`:

```yaml
name: OpenClaw Bot

on:
  schedule:
    - cron: '0 */6 * * *'  # Heartbeat every 6 hours
  issue_comment:
    types: [created]
  issues:
    types: [opened]
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:

jobs:
  openclaw:
    runs-on: ubuntu-latest
    
    if: |
      github.event_name != 'issue_comment' || 
      contains(github.event.comment.body, '@openclaw')
    
    permissions:
      contents: write
      issues: write
      pull-requests: write
    
    steps:
      - uses: offloadmywork/openclaw-github-app@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 2. Add your Anthropic API key

1. Get an API key from [Anthropic Console](https://console.anthropic.com/)
2. Go to your repo → Settings → Secrets and variables → Actions
3. Add a new repository secret: `ANTHROPIC_API_KEY`

### 3. Trigger the bot

- **Open an issue** - Bot will respond
- **Comment on an issue with `@openclaw`** - Bot will reply
- **Open a PR** - Bot will review
- **Wait for heartbeat** - Bot checks in every 6 hours
- **Manual trigger** - Go to Actions → OpenClaw Bot → Run workflow

## 🎛️ Configuration

### Inputs

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `anthropic_api_key` | Anthropic API key | - | ✅ |
| `model` | Claude model | `claude-sonnet-4-20250514` | ❌ |
| `workspace_path` | Workspace directory | `.openclaw` | ❌ |
| `github_token` | GitHub token | `${{ github.token }}` | ❌ |

### Customizing the bot

Edit `.openclaw/SOUL.md` in your repository to customize the bot's personality and purpose:

```markdown
# SOUL.md

I am a helpful code review bot for this TypeScript project.

## My Focus
- Code quality and best practices
- Security vulnerabilities
- Performance optimizations

## My Style
- Friendly but direct
- Always suggest improvements, never just criticize
- Provide code examples when possible
```

Commit this file and the bot will adopt the new identity on its next run.

## 🧪 How It Works

### 1. Workspace Management (`workspace.ts`)

- Restores workspace from GitHub Actions cache on start
- Initializes `SOUL.md` and `MEMORY.md` if missing
- Loads recent daily logs (last 7 days)
- Saves workspace back to cache after run

Cache key: `openclaw-workspace-{owner/repo}-{sha}` with fallback restore keys.

### 2. Trigger Parsing (`triggers.ts`)

Detects what triggered the workflow and extracts context:

- `schedule` → Heartbeat
- `issue_comment` → Comment details, issue context
- `issues` → New issue details
- `pull_request` → PR details, diff (truncated to 10KB)
- `workflow_dispatch` → Manual trigger

### 3. Agent Runner (`agent.ts`)

- Builds a comprehensive prompt from workspace + trigger context
- Calls Claude API
- Parses response for action commands:
  - `**COMMENT:** {number} {text}` - Post comment
  - `**UPDATE_MEMORY:** {text}` - Update MEMORY.md
- Auto-posts responses to issues/PRs when appropriate
- Logs everything to daily log

### 4. Action Integration (`action.yml`)

Composite action that:
- Checks out repo
- Sets up Node.js
- Installs dependencies
- Runs the TypeScript entry point

This makes it reusable across repositories.

## 🔧 Development

### Local Setup

```bash
git clone https://github.com/offloadmywork/openclaw-github-app.git
cd openclaw-github-app
npm install
npm run build
```

### Build

```bash
npm run build
```

Compiles TypeScript to `dist/index.js` using esbuild.

### Type Checking

```bash
npm run typecheck
```

## 📦 How to Use in Your Repo

**Option 1: Reference the action**

```yaml
- uses: offloadmywork/openclaw-github-app@main
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Option 2: Fork and customize**

1. Fork this repo
2. Modify `src/` files as needed
3. Commit and push
4. Reference your fork: `uses: yourname/openclaw-github-app@main`

## 🤝 Contributing

This is an MVP! Contributions welcome:

- Better prompt engineering
- More action types (create PRs, update files)
- Smarter memory management
- Tool use / function calling
- Multi-repo support

## 📝 TODO

- [ ] Support for creating PRs from agent
- [ ] File editing capabilities
- [ ] Tool use (search repos, fetch docs)
- [ ] Better diff handling for large PRs
- [ ] Configurable triggers per repo
- [ ] Multi-model support
- [ ] Cost tracking and limits

## 📄 License

MIT

## 🙏 Credits

Built with:
- [Anthropic Claude](https://anthropic.com) - The AI brain
- [GitHub Actions](https://github.com/features/actions) - The runtime
- [TypeScript](https://typescriptlang.org) - The language

Part of the [OpenClaw](https://github.com/offloadmywork) ecosystem.
