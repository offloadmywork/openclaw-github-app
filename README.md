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
- 📚 **Rich repo context** — automatically includes README, recent commits, and open issues
- 🔍 **PR code review** — analyzes diffs and posts inline review comments
- ⚙️ **Configurable** — customize behavior via `.openclaw.yml`
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

### Repository Context (`.openclaw.yml`)

The bot automatically builds context about your repository including README, recent commits, and open issues. You can customize this behavior by creating `.openclaw.yml` (or `.github/openclaw.yml`):

```yaml
# Custom system prompt for your project
system_prompt: |
  You are a code reviewer for a TypeScript project.
  Focus on type safety, error handling, and performance.
  Always suggest specific improvements with code examples.

# Control what context is included
context:
  include_readme: true      # Include README.md content (default: true)
  readme_max_chars: 4000    # Max chars for README (default: 4000)
  recent_commits: 10        # Number of recent commits to include (default: 10)
  open_issues: true         # Include open issues list (default: true)
  max_issues: 15            # Max number of issues to include (default: 15)
```

#### Context Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `system_prompt` | string | - | Custom instructions for the bot |
| `context.include_readme` | boolean | `true` | Include README.md content |
| `context.readme_max_chars` | number | `4000` | Maximum characters from README |
| `context.recent_commits` | number | `10` | Number of recent commits to show |
| `context.open_issues` | boolean | `true` | Include open issues list |
| `context.max_issues` | number | `15` | Maximum open issues to show |

The context is automatically injected into every message, giving the bot awareness of your project's purpose, recent activity, and current work.

### PR Code Review

When a pull request is opened or updated, the bot automatically:
1. Fetches the full diff
2. Analyzes the code changes
3. Posts a structured review with inline comments

The review includes:
- **Summary** — Overall assessment of the PR
- **Inline comments** — Specific feedback on individual lines
- **Verdict** — `approve`, `request_changes`, or `comment`

**Example review output:**
```
🤖 OpenClaw Bot Review

The PR looks good overall. A few suggestions:

**src/utils.ts:42**
Consider using `const` instead of `let` here since the value is never reassigned.

**src/api.ts:78**
This error handling could be more specific. Consider catching `NetworkError` separately.
```

The bot uses GitHub's native review system, so comments appear directly on the relevant lines in the PR diff view.

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

### Local Development

```bash
# Clone the repository
git clone https://github.com/offloadmywork/openclaw-github-app.git
cd openclaw-github-app

# Install dependencies
npm install

# Build the action
npm run build

# Type check
npm run typecheck
```

### Building & Publishing

The action uses esbuild to bundle the TypeScript source into `dist/index.js`. When making changes:

1. Edit source files in `src/`
2. Run `npm run build` to compile
3. Test the action in a test repository
4. Commit both source and dist changes
5. Push to `main` (or create a tagged release)

**Important:** Always commit the `dist/` directory and `node_modules/` with your changes. GitHub Actions need these to run.

### Release Process

```bash
# After testing your changes
git add src/ dist/ node_modules/
git commit -m "feat: your feature description"
git push origin main

# Create a tagged release (optional, for version pinning)
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

Users can then reference specific versions:
- `@main` — latest (may have breaking changes)
- `@v1` — major version (recommended)
- `@v1.2.3` — exact version (most stable)

### Testing Locally

You can test the action locally:

1. Install OpenClaw globally: `npm install -g openclaw`
2. Set required environment variables:
   ```bash
   export INPUT_API_KEY=your_api_key
   export INPUT_PROVIDER=anthropic
   export INPUT_MODEL=claude-sonnet-4-5
   export GITHUB_TOKEN=your_github_token
   export GITHUB_REPOSITORY=owner/repo
   ```
3. Run: `node dist/index.js`

### Testing in a Repository

Create a test repository and add a workflow file (`.github/workflows/openclaw.yml`) that uses your fork:

```yaml
- uses: your-username/openclaw-github-app@your-branch
  with:
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Caching

The action automatically caches:
- **OpenClaw installation** — Speeds up subsequent runs by ~30-60s
- **Workspace files** — Maintains bot memory and context across runs

Cache keys are stable and version-pinned, so cache invalidation happens automatically when OpenClaw updates.

## Self-Hosting & Forking

Want to customize the bot or host your own version? Here's how:

### 1. Fork the Repository

Click "Fork" on GitHub or:
```bash
gh repo fork offloadmywork/openclaw-github-app --clone
```

### 2. Customize (Optional)

Edit files in `src/` to customize behavior:
- `src/triggers.ts` — Modify what events trigger the bot
- `src/index.ts` — Change bot installation/setup logic
- `src/gateway.ts` — Adjust OpenClaw configuration

Then rebuild:
```bash
npm run build
git add src/ dist/
git commit -m "feat: custom behavior"
git push
```

### 3. Use Your Fork

In your workflows, reference your fork:

```yaml
- uses: your-username/openclaw-github-app@main
  with:
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### 4. Keep Up to Date

Sync your fork periodically:
```bash
gh repo sync your-username/openclaw-github-app
```

Or set up GitHub Actions to auto-sync your fork.

### One-Click Setup

If you forked the repo, you can create a workflow in your fork that automatically sets it up in new repositories:

1. Add `.github/workflows/setup-openclaw.yml` to your fork
2. Use `workflow_dispatch` to trigger setup
3. The workflow can commit the OpenClaw workflow file to target repos

This enables "install with one click" for all your repositories.

## Contributing

This is a thin wrapper — most improvements should go to OpenClaw itself. But wrapper-specific improvements are welcome!

### How to Contribute

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` and `npm run typecheck`
5. Test in a real repository
6. Submit a pull request

### Contribution Areas

- **Performance** — Faster installs, better caching
- **Features** — New trigger types, configuration options
- **Documentation** — Clearer guides, more examples
- **Bug Fixes** — Error handling, edge cases

## License

MIT

## Support

- **Issues**: https://github.com/offloadmywork/openclaw-github-app/issues
- **OpenClaw Docs**: https://openclaw.dev
- **Discord**: Join the OpenClaw community
