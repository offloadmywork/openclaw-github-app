# OpenClaw GitHub Bot

An AI-powered bot for your GitHub repository, powered by **real OpenClaw** — the same agent framework that powers WhatsApp bots, Discord bots, and personal assistants.

## What is this?

This GitHub Action brings OpenClaw to your repository. Instead of being a standalone agent implementation, this is a thin wrapper that:

1. Installs OpenClaw in GitHub Actions
2. Starts the OpenClaw Gateway
3. Translates GitHub events into messages
4. Sends them to OpenClaw via WebSocket
5. Posts the agent's response back to GitHub

**Why this matters:** You get the full power of OpenClaw — the same reasoning, memory system, and capabilities — now available in your GitHub workflows.

## Features

- 🤖 **Real OpenClaw** — same agent, same capabilities
- 💭 **Persistent memory** — maintains context across runs via GitHub Actions Cache
- 🔄 **Heartbeat checks** — periodic reviews of your repo
- 💬 **Issue/PR responses** — intelligent comments on issues and pull requests
- 🧠 **Learning** — builds up memory and understanding of your project over time

## Quick Start

Create `.github/workflows/openclaw.yml`:

```yaml
name: OpenClaw Bot

on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  openclaw:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: offloadmywork/openclaw-github-app@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          model: claude-sonnet-4-20250514
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `anthropic_api_key` | Your Anthropic API key | Yes | - |
| `model` | Claude model to use | No | `claude-sonnet-4-20250514` |
| `github_token` | GitHub token for API access | No | `${{ github.token }}` |

### Secrets

Add your Anthropic API key to repository secrets:
1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `ANTHROPIC_API_KEY`
4. Value: Your API key from https://console.anthropic.com/

## How It Works

### Architecture

```
GitHub Event → GitHub Actions → Install OpenClaw
                                      ↓
                               Start Gateway (localhost:18789)
                                      ↓
                               Restore workspace from cache
                                      ↓
                               Translate event → message
                                      ↓
                               Send to OpenClaw via WebSocket
                                      ↓
                               Wait for agent response
                                      ↓
                               Post response to GitHub
                                      ↓
                               Save workspace to cache
                                      ↓
                               Stop Gateway
```

### Workspace & Memory

OpenClaw maintains a workspace in `.openclaw/` with:
- `SOUL.md` — the bot's identity and purpose
- `MEMORY.md` — curated long-term memory
- `memory/YYYY-MM-DD.md` — daily logs

This workspace is cached between runs using GitHub Actions Cache, giving the bot continuity and context.

### Triggers

The bot responds to:

- **Schedule** → Heartbeat check (reviews repo, looks for work)
- **Issue comment** → Responds to comments
- **Issue opened** → Welcomes and provides guidance
- **Pull request** → Reviews and provides feedback
- **Manual** → Workflow dispatch for manual triggers

## Customization

### Customize the Bot's Personality

After the first run, the bot creates `SOUL.md` in its workspace. You can customize this by:

1. Running the action once
2. Checking the workspace (it's in the cache, but you can add a step to commit it)
3. Editing `SOUL.md` to define the bot's personality and purpose

### Example SOUL.md

```markdown
# SOUL.md - Who Am I?

I am the OpenClaw bot for [Your Project].

## Purpose
I help maintain this repository by:
- Welcoming new contributors
- Answering common questions
- Reviewing PRs for best practices
- Keeping the team informed

## Personality
I'm friendly, helpful, and focused on making contributors successful.
I use clear language and avoid jargon unless necessary.
```

## Advanced Usage

### Heartbeat Customization

Add a `HEARTBEAT.md` to your `.openclaw/` workspace to define what the bot should check during heartbeats:

```markdown
# Heartbeat Tasks

Check every 6 hours:
- Open issues without labels
- PRs waiting for review >48h
- Questions in discussions
```

### Memory Management

The bot automatically maintains:
- Daily logs in `memory/YYYY-MM-DD.md`
- Long-term memory in `MEMORY.md`

You can review and curate these files to guide the bot's understanding of your project.

## Comparison: Wrapper vs Standalone

**Before (Standalone Agent):**
- Custom implementation using Anthropic SDK
- Manual prompt engineering
- Limited capabilities
- Hard to maintain/extend

**Now (OpenClaw Wrapper):**
- Full OpenClaw agent with all capabilities
- Shared codebase with other OpenClaw deployments
- Automatic updates when OpenClaw improves
- Same agent across all platforms (WhatsApp, Discord, GitHub)

## Development

### Building

```bash
npm install
npm run build
```

### Testing Locally

You can test the workflow locally, but you'll need:
1. OpenClaw installed globally (`npm install -g openclaw`)
2. Set environment variables for inputs
3. Run `node dist/index.js`

## Contributing

This is a thin wrapper — most improvements should go to OpenClaw itself. But wrapper-specific improvements are welcome!

## License

MIT

## Support

- Issues: https://github.com/offloadmywork/openclaw-github-app/issues
- OpenClaw: https://github.com/yourusername/openclaw (adjust as needed)
