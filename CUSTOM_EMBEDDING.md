# Custom Embedding Provider Guide

**Version**: v1.0.0 Remastered
**Last Updated**: 2026-02-10

---

## Overview

claude-mem supports custom embedding providers compatible with the OpenAI API format. This allows you to use alternative providers like **z.ai**, local embedding models, or any OpenAI-compatible API.

---

## Supported Providers

| Provider | Type | Status |
|----------|------|--------|
| OpenAI | Official | ✅ Fully Supported |
| Custom (z.ai, etc.) | OpenAI-Compatible | ✅ Supported |
| SDKAgent | Built-in | ⚠️ TODO |

---

## Quick Setup for z.ai

### Step 1: Get your z.ai API Key

1. Sign up for [z.ai](https://z.ai)
2. Navigate to API Keys
3. Create a new API key
4. Copy your key

### Step 2: Set Environment Variables

**Windows PowerShell:**
```powershell
# Set custom embedding configuration
$env:EMBEDDING_CUSTOM_ENDPOINT = "https://api.z.ai/v1/embeddings"
$env:EMBEDDING_CUSTOM_API_KEY = "your-z.ai-api-key"
$env:EMBEDDING_CUSTOM_MODEL = "text-embedding-ada-002"  # Or your preferred model
```

**Linux / macOS:**
```bash
# Set custom embedding configuration
export EMBEDDING_CUSTOM_ENDPOINT="https://api.z.ai/v1/embeddings"
export EMBEDDING_CUSTOM_API_KEY="your-z.ai-api-key"
export EMBEDDING_CUSTOM_MODEL="text-embedding-ada-002"
```

### Step 3: Restart Worker

```bash
# Using Bun
bun worker-service.cjs restart

# Or via npm
npm run worker:restart
```

### Step 4: Verify

Check the worker logs for confirmation:
```
[INFO] [WORKER] EmbeddingService initialized with custom provider {
  endpoint: 'https://api.z.ai/v1/embeddings',
  model: 'text-embedding-ada-002'
}
```

---

## Configuration Options

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `EMBEDDING_CUSTOM_ENDPOINT` | ✅ Yes | Full URL to embeddings API | `https://api.z.ai/v1/embeddings` |
| `EMBEDDING_CUSTOM_API_KEY` | ✅ Yes | Your API key | `sk-...` |
| `EMBEDDING_CUSTOM_MODEL` | Optional | Model name | `text-embedding-ada-002` |

### Priority Order

claude-mem checks for embedding providers in this order:

1. **Custom** (if `EMBEDDING_CUSTOM_ENDPOINT` + `EMBEDDING_CUSTOM_API_KEY` are set)
2. **OpenAI** (if `EMBEDDING_OPENAI_API_KEY` or `OPENAI_API_KEY` is set)
3. **None** (falls back to SQLite full-text search only)

---

## API Compatibility

Your custom provider **must** be compatible with the OpenAI embeddings API format:

### Request Format

```json
POST /v1/embeddings
{
  "input": "Your text here",
  "model": "text-embedding-ada-002"
}
```

### Response Format (Option 1 - OpenAI Standard)

```json
{
  "data": [
    {
      "embedding": [0.1, 0.2, 0.3, ...]
    }
  ]
}
```

### Response Format (Option 2 - Direct)

```json
{
  "embedding": [0.1, 0.2, 0.3, ...]
}
```

Both formats are supported.

---

## Common Providers

### z.ai

```powershell
$env:EMBEDDING_CUSTOM_ENDPOINT = "https://api.z.ai/v1/embeddings"
$env:EMBEDDING_CUSTOM_API_KEY = "your-z.ai-key"
$env:EMBEDDING_CUSTOM_MODEL = "text-embedding-ada-002"
```

### Local OpenAI-Compatible Server

```powershell
$env:EMBEDDING_CUSTOM_ENDPOINT = "http://localhost:8000/v1/embeddings"
$env:EMBEDDING_CUSTOM_API_KEY = "dummy-key"
$env:EMBEDDING_CUSTOM_MODEL = "local-model"
```

### Other Providers

Check your provider's documentation for:
- API endpoint URL
- Authentication method (Bearer token)
- Model names available
- Request/response format compatibility

---

## Testing Your Configuration

### 1. Test API Directly

```bash
curl -X POST https://api.z.ai/v1/embeddings \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":"test","model":"text-embedding-ada-002"}'
```

### 2. Test with claude-mem

```bash
# Search for something (will use your custom provider)
curl "http://localhost:37777/api/search/observations?query=test&limit=5"
```

### 3. Check Logs

```bash
tail -f ~/.claude-mem/logs/claude-mem-*.log
```

Look for:
- `EmbeddingService initialized with custom provider`
- `Calling custom embedding API`
- `Cache hit` (for repeated queries)

---

## Troubleshooting

### "Custom embedding provider not configured"

**Cause**: Missing `EMBEDDING_CUSTOM_ENDPOINT` or `EMBEDDING_CUSTOM_API_KEY`

**Fix**: Set both environment variables and restart worker

### "Custom embedding API error: 401"

**Cause**: Invalid API key

**Fix**: Verify your API key is correct and active

### "Invalid custom API response format"

**Cause**: Your provider doesn't return data in OpenAI-compatible format

**Fix**: Check provider documentation for response format

### Vector search still disabled

**Cause**: Worker not restarted after setting environment variables

**Fix**: Restart the worker service

---

## Performance Tips

### 1. Enable Caching (Automatic)

Embeddings are **automatically cached** in SQLite. Subsequent searches for the same text use cached embeddings (99% reduction in API calls).

### 2. Choose Fast Models

- `text-embedding-ada-002`: Fast, 1536 dimensions ✅ Recommended
- Larger models may be slower but more accurate

### 3. Batch When Possible

claude-mem caches individual embeddings, so repeated searches become faster over time.

---

## Migration from OpenAI to z.ai

### Step 1: Backup (Optional)

```bash
# Export your memory
curl http://localhost:37777/api/export > claude-mem-backup.json
```

### Step 2: Switch Provider

```powershell
# Remove OpenAI key (if set)
$env:EMBEDDING_OPENAI_API_KEY = ""
$env:OPENAI_API_KEY = ""

# Set z.ai configuration
$env:EMBEDDING_CUSTOM_ENDPOINT = "https://api.z.ai/v1/embeddings"
$env:EMBEDDING_CUSTOM_API_KEY = "your-z.ai-key"
```

### Step 3: Restart Worker

```bash
bun worker-service.cjs restart
```

### Step 4: Verify

```bash
curl http://localhost:37777/api/health
```

Look for `"initialized":true` in the response.

---

## Advanced: Running Multiple Providers

You can switch between providers without losing data:

```bash
# Use OpenAI for one session
export EMBEDDING_OPENAI_API_KEY="sk-..."
bun worker-service.cjs restart

# Switch to z.ai for next session
export EMBEDDING_CUSTOM_ENDPOINT="https://api.z.ai/v1/embeddings"
export EMBEDDING_CUSTOM_API_KEY="z.ai-key"
bun worker-service.cjs restart
```

The embedding cache is shared across providers, so previously cached embeddings work regardless of which provider generated them.

---

## Need Help?

- **Documentation**: https://docs.claude-mem.ai
- **GitHub Issues**: https://github.com/Pamacea/claude-mem/issues
- **Community**: https://github.com/Pamacea/claude-mem/discussions

---

**Version**: v1.0.0 Remastered
**Status**: Production Ready
