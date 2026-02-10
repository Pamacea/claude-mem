# Installation Guide - claude-mem v1.0.0 Remastered

> **Version**: v1.0.0 Remastered
> **Time**: 5 minutes
> **Difficulty**: Beginner
> **Platforms**: Linux, macOS, Windows

---

## 🚀 Quick Install (One Command)

```bash
/plugin marketplace add pamacea/claude-mem
/plugin install claude-mem
```

**That's it!** Restart Claude Code and you're done.

---

## 📋 Prerequisites

### Required

- ✅ **Claude Code** (latest version with plugin support)
- ✅ **Node.js** 18+ (for building plugins)

### Auto-Installed (if missing)

- ✅ **Bun** (JavaScript runtime - auto-installed)
- ✅ **sqlite-vec** (vector search extension - auto-installed)

### Optional

- ⚠️ **OpenAI API Key** (for vector semantic search)

```bash
# Set your API key (optional but recommended)
export EMBEDDING_OPENAI_API_KEY=sk-...
# OR
export OPENAI_API_KEY=sk-...
```

**Windows PowerShell:**
```powershell
$env:EMBEDDING_OPENAI_API_KEY='sk-...'
# OR
$env:OPENAI_API_KEY='sk-...'
```

---

## 🎯 Installation Steps

### Step 1: Add Plugin

```bash
/plugin marketplace add thedotmack/claude-mem
```

### Step 2: Install Plugin

```bash
/plugin install claude-mem
```

### Step 3: Restart Claude Code

Quit and restart Claude Code.

### Step 4: Verify Installation

Open a new Claude Code session and run:

```
What was I working on yesterday?
```

If claude-mem is working, it will search your memory and provide context.

---

## 🔧 Post-Installation

### Verify Worker Status

```bash
# Check if worker is running
curl http://localhost:37777/api/health

# Expected output:
# {"status":"ok","timestamp":"2025-02-10T..."}
```

**Windows:**
```powershell
Invoke-WebRequest -Uri "http://localhost:37777/api/health" -UseBasicParsing
```

### Access Web Viewer

Open your browser to:
```
http://localhost:37777
```

You should see the claude-mem viewer UI showing your memory stream.

---

## ⚙️ Configuration

### Default Settings

claude-mem auto-creates `~/.claude-mem/settings.json` on first run.

### Configure Vector Search

```json
{
  "search": {
    "vectorSearchEnabled": true,
    "embeddingProvider": "openai"
  }
}
```

**With OpenAI API key**:
```bash
export EMBEDDING_OPENAI_API_KEY=sk-...
```

**Without API key**: Falls back to SQLite full-text search (still works!)

---

## 🔄 Upgrading from v9.x

### Automatic Migration

**Linux / macOS:**
```bash
bash scripts/finish-phase2.sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\finish-phase2.ps1
```

This script:
1. Checks prerequisites
2. Installs sqlite-vec
3. Runs database migration
4. Migrates ChromaDB data (optional)
5. Removes obsolete files (optional)
6. Verifies installation

**Time**: 10-15 minutes

---

## 🐛 Troubleshooting

### Plugin Not Showing Up

```bash
# Verify installation
ls ~/.claude/plugins/marketplaces/thedotmack/

# Should show claude-mem directory
```

### Worker Not Starting

```bash
# Check logs
bun worker:logs

# Restart worker
bun worker:restart
```

### Vector Search Not Working

```bash
# Check API key
echo $EMBEDDING_OPENAI_API_KEY

# Verify database
sqlite3 ~/.claude-mem/claude-mem.db ".tables vec_*"

# Should show: vec_obs vec_sessions vec_prompts
```

### Windows Popup Issues

**v1.0.0 Remastered fixes this!** No more subprocess popups.

If you still see popups:
1. Verify you're on v1.0.0 Remastered
2. Run: `npm run build-and-sync`
3. Restart Claude Code

---

## 📊 What's Installed

### Files Created

```
~/.claude-mem/
├── claude-mem.db           # SQLite database
├── settings.json            # Configuration
├── logs/                     # Worker logs
└── backups/                 # Automatic backups
```

### Processes Running

- **Worker Service** (Bun) - HTTP API on port 37777
- **Hooks** - 5 lifecycle hooks

### Memory Usage

- **Idle**: ~100-150MB
- **Active**: ~300MB (50% less than v9.x)

---

## 🎓 Next Steps

### 1. Test It

Ask Claude Code:
```
What have I been working on recently?
```

### 2. Configure (Optional)

Edit `~/.claude-mem/settings.json`:

```json
{
  "context": {
    "maxTokens": 8000,
    "progressiveDisclosure": true
  },
  "search": {
    "vectorSearchEnabled": true
  }
}
```

### 3. Read Documentation

- **[Full README](./README.md)** - Complete feature overview
- **[CHANGELOG.md](./CHANGELOG.md)** - v1.0.0 Remastered release notes
- **[User Guide](./PHASE2_USER_GUIDE.md)** - Detailed migration guide

---

## 🆘 Getting Help

### Automatic Troubleshooting

Just describe the problem to Claude Code:

```
claude-mem isn't working, I see [describe error]
```

The troubleshoot skill will automatically diagnose and provide fixes.

### Manual Troubleshooting

**[Troubleshooting Guide](https://docs.claude-mem.ai/troubleshooting)**

### Community Support

- **GitHub Issues**: [github.com/thedotmack/claude-mem/issues](https://github.com/thedotmack/claude-mem/issues)
- **Documentation**: [docs.claude-mem.ai](https://docs.claude-mem.ai)

---

## ✅ Installation Checklist

After installation, verify:

- [ ] Plugin installed in marketplace
- [ ] Worker running (http://localhost:37777/api/health)
- [ ] Can search memory with `mem-search` skill
- [ ] Web viewer accessible at http://localhost:37777
- [ ] No errors in logs (`bun worker:logs`)

---

## 🎉 You're Ready!

claude-mem will now automatically:
- ✅ Capture your work across sessions
- ✅ Compress and summarize context
- ✅ Search your memory intelligently
- ✅ Inject relevant context when needed

**Enjoy v1.0.0 Remastered!** 🚀

---

**Version**: v1.0.0 Remastered
**Status**: Production Ready
**Upgrade**: Highly Recommended (if upgrading from v9.x)
