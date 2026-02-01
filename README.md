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

**Provider-agnostic:** Works with Anthropic, xAI, OpenAI, Google, Groq, OpenRouter, Cerebras, and Mistral.

## Features

- 🤖 **Real OpenClaw** — same agent, same capabilities
- 🔌 **Multi-provider** — use Anthropic, xAI, OpenAI, Google, or others
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
    types: [opened, edited]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize, reopened]
  pull_request_review_comment:
    types: [created]
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:
    inputs:
      message:
        description: 'Custom message to send to the agent'
        required: false
        default: 'Manual trigger - review the repo'

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  openclaw:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      
      - uses: offloadmywork/openclaw-github-app@main
        with:
          api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          provider: 'anthropic'
          model: 'claude-sonnet-4-5'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api_key` | API key for your chosen provider | Yes | - |
| `provider` | AI provider (anthropic, xai, openai, google, groq, etc.) | No | `anthropic` |
| `model` | Model to use (e.g., claude-sonnet-4-5, grok-3-fast) | No | Provider default |
| `github_token` | GitHub token for API access | No | `${{ github.token }}` |

### Providers & Models

| Provider | Example Models | Secret Name |
|----------|----------------|-------------|
| `anthropic` | `claude-sonnet-4-5`, `claude-opus-4-5` | `ANTHROPIC_API_KEY` |
| `xai` | `grok-3-fast`, `grok-3-medium` | `XAI_API_KEY` |
| `openai` | `gpt-4.1-mini`, `gpt-4.1` | `OPENAI_API_KEY` |
| `google` | `gemini-2.5-flash`, `gemini-2.5-pro` | `GEMINI_API_KEY` |
| `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `openrouter` | `anthropic/claude-sonnet-4-5` | `OPENROUTER_API_KEY` |

**Note:** Model names can include or omit the provider prefix. For example, both `claude-sonnet-4-5` and `anthropic/claude-sonnet-4-5` work.

### Secrets

Add your API key to repository secrets:
1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `ANTHROPIC_API_KEY` (or your provider's key name)
4. Value: Your API key

## Examples

### Using xAI (Grok)

```yaml
- uses: offloadmywork/openclaw-github-app@main
  with:
    api_key: ${{ secrets.XAI_API_KEY }}
    provider: 'xai'
    model: 'grok-3-fast'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Using OpenAI

```yaml
- uses: offloadmywork/openclaw-github-app@main
  with:
    api_key: ${{ secrets.OPENAI_API_KEY }}
    provider: 'openai'
    model: 'gpt-4.1-mini'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Using Google Gemini

```yaml
- uses: offloadmywork/openclaw-github-app@main
  with:
    api_key: ${{ secrets.GEMINI_API_KEY }}
    provider: 'google'
    model: 'gemini-2.5-flash'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

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

This workspace is **cached per branch** using GitHub Actions Cache, giving the bot continuity and context across runs on the same branch.

**Important:** Cache is branch-specific. Each branch has its own memory, so the bot doesn't get confused by branch-specific work.

### Triggers

The bot responds to:

- **Schedule** → Heartbeat check (reviews repo, looks for work)
- **Issue comment** → Responds to comments
- **Issue opened/edited** → Welcomes and provides guidance
- **Pull request** → Reviews and provides feedback
- **PR review comments** → Participates in code reviews
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

### Permissions

The action requires these permissions:

```yaml
permissions:
  contents: read        # Read repository files
  issues: write        # Comment on issues
  pull-requests: write # Comment on PRs
```

If your workflow needs additional permissions (e.g., to create branches), add them explicitly.

## Comparison: Wrapper vs Standalone

**Before (Standalone Agent):**
- Custom implementation using provider SDK
- Manual prompt engineering
- Limited capabilities
- Hard to maintain/extend

**Now (OpenClaw Wrapper):**
- Full OpenClaw agent with all capabilities
- Shared codebase with other OpenClaw deployments
- Automatic updates when OpenClaw improves
- Same agent across all platforms (WhatsApp, Discord, GitHub)
- Provider-agnostic (switch models/providers easily)

## Troubleshooting

### Cache Issues

If the bot seems to have lost its memory:
- Check the Actions cache (Settings → Actions → Caches)
- Cache is branch-specific — each branch has separate memory
- Cache entries expire after 7 days of no use

### Timeout Issues

If the bot times out:
- Default timeout is 15 minutes (adjust with `timeout-minutes`)
- The bot has a 120-second lifecycle timeout for agent responses
- Check Gateway logs for errors

### API Key Issues

Make sure:
- The secret name matches your provider (e.g., `ANTHROPIC_API_KEY` for Anthropic)
- The secret is set at repository or organization level
- The API key has sufficient credits/quota

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
- OpenClaw: https://github.com/openclaw/openclaw
