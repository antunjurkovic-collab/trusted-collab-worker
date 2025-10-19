# Trusted Collaboration Tunnel (TCT) — Cloudflare Worker

Edge worker implementation of the Trusted Collaboration Tunnel protocol for efficient content delivery to AI crawlers.

## Overview

This Cloudflare Worker acts as an edge proxy for TCT endpoints, providing:
- ETag-based conditional request handling (HEAD and GET with If-None-Match)
- 304 Not Modified responses for unchanged content
- Optional policy link injection (`Link: rel="terms"`, `Link: rel="payment"`)
- Optional API key authentication
- Optional usage receipt generation (HMAC-signed)

## Features

- **Template-Invariant Fingerprinting:** Respects origin ETag headers
- **Conditional Request Discipline:** Honors If-None-Match, returns 304 when appropriate
- **HEAD Fallback:** Supports HEAD requests, falls back to GET if origin doesn't support HEAD
- **Link Header Parsing:** Extracts and validates canonical links from origin
- **Multi-Value If-None-Match:** Handles comma-separated ETag lists
- **Usage Receipts:** Cryptographically signed metadata (when enabled)

## Measured Results

Based on production deployments across 970+ URLs:
- **83% bandwidth reduction** (103 KB → 17.7 KB average)
- **90%+ 304 rate** for unchanged content (reduced network transfer)
- **100% protocol compliance**

## Quick Start

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Configure

```bash
# Copy example configuration
cp wrangler.toml.example wrangler.toml

# Edit wrangler.toml with your account ID and routes
nano wrangler.toml
```

### 3. Set Secrets

```bash
# Set API keys (if using authentication)
wrangler secret put API_KEYS
# Enter: "key1_32chars_minimum,key2_32chars_minimum"

# Set HMAC key (if using receipts)
wrangler secret put RECEIPT_KEY
# Enter: (32+ byte random secret, same as origin server)
```

### 4. Deploy

```bash
# Deploy to workers.dev (testing)
wrangler deploy

# Deploy to production environment
wrangler deploy --env production
```

## Configuration

### Environment Variables (Non-Sensitive)

Set these in `wrangler.toml` under `[vars]`:

```toml
[vars]
TERMS_URL = "https://example.com/terms"     # Optional: Terms of service URL
PRICING_URL = "https://example.com/pricing" # Optional: Pricing/payment URL
ORIGIN_BASE = "https://origin.example.com"  # Optional: Origin server base URL
DEBUG = false                                # Optional: Enable debug logging
```

### Secrets (Sensitive - Use CLI)

**DO NOT put these in wrangler.toml!** Use `wrangler secret put`:

| Secret | Description | Required | Format |
|--------|-------------|----------|--------|
| `API_KEYS` | Comma-separated API keys for authentication | Only if using auth | `"key1,key2,key3"` (32+ chars each) |
| `RECEIPT_KEY` | HMAC secret for usage receipt signing | Only if using receipts | 32+ bytes (256 bits), must match origin |

**Examples:**

```bash
# API Keys
wrangler secret put API_KEYS
> Enter secret: example_key_abc123def456ghi789jkl012mno345pq,another_key_xyz987wvu654tsr321qpo098nml765

# Receipt Key
wrangler secret put RECEIPT_KEY
> Enter secret: supersecret32bytesminimumrandomhmackey123456
```

### Routes Configuration

In `wrangler.toml`:

```toml
[[routes]]
pattern = "example.com/llm-sitemap.json"
zone_name = "example.com"

[[routes]]
pattern = "example.com/*/llm/*"
zone_name = "example.com"

[[routes]]
pattern = "example.com/llms.txt"
zone_name = "example.com"
```

## API Reference

### Endpoints

**Sitemap:**
- Path: `/llm-sitemap.json`
- Returns: JSON array of `{ cUrl, mUrl, modified, contentHash }`
- Headers: `Content-Type: application/json`, `ETag`, `Cache-Control`

**Machine Endpoint:**
- Path: `/{canonical}/llm/`
- Returns: JSON with normalized content
- Headers: `Link: rel="canonical"`, `ETag`, `Vary: Accept`
- Supports: HEAD and GET with If-None-Match

**Manifest:**
- Path: `/llms.txt`
- Returns: Plain text manifest
- Headers: `Content-Type: text/plain`

### HTTP Headers

**Request Headers (client → worker):**
- `If-None-Match`: ETag value(s) for conditional request
- `Authorization`: Bearer token (if API auth enabled)
- `Accept`: Content type negotiation

**Response Headers (worker → client):**
- `ETag`: Content hash (from origin or generated)
- `Link`: Canonical URL, policy URLs (terms, pricing)
- `Cache-Control`: Caching directives
- `Vary: Accept`: Content negotiation signal
- `AI-Usage-Receipt`: HMAC-signed usage metadata (if enabled)

### Conditional Requests

**HEAD Request:**
```bash
# Check if content changed
curl -I https://example.com/post-slug/llm/
```

**GET with If-None-Match:**
```bash
# Get content only if ETag doesn't match
curl -H 'If-None-Match: "sha256-abc123"' https://example.com/post-slug/llm/
```

**Expected Responses:**
- `200 OK` - Content returned (body included)
- `304 Not Modified` - Content unchanged (no body)
- `401 Unauthorized` - Invalid/missing API key (if auth enabled)
- `500 Internal Server Error` - Origin fetch failed

## Security Considerations

**Before deploying to production, review [SECURITY.md](SECURITY.md) for complete security guidance.**

### Key Security Points

**Secrets Management:**
- ALWAYS use `wrangler secret put` for sensitive values
- NEVER commit API keys or HMAC secrets to version control
- Rotate secrets regularly (every 90 days recommended)

**API Keys:**
- Minimum 32 characters, cryptographically random
- Store in Cloudflare Secrets (not environment variables)
- Format: Comma-separated list: `"key1,key2,key3"`

**HMAC Key:**
- Minimum 32 bytes (256 bits)
- Must match origin server's `tct_receipt_hmac_key`
- Used for usage receipt signing/verification

**Rate Limiting:**
- Configure Cloudflare Rate Limiting rules:
  - `/llm-sitemap.json`: 60 requests/min per IP
  - `/*/llm/*`: 120 requests/min per IP

**Logging:**
- Enable logpush with sensitive field redaction
- DO NOT log API keys, HMAC secrets, or full receipts
- Use Cloudflare Analytics for aggregate metrics

**Caching:**
- Respect origin `ETag` headers (pass through)
- Cache 304 responses (no body)
- DO NOT cache usage receipts (always unique)

## Development

### Local Testing

```bash
# Start local dev server
wrangler dev

# Test endpoints
curl http://localhost:8787/llm-sitemap.json
curl http://localhost:8787/test-post/llm/
curl -I -H 'If-None-Match: "test"' http://localhost:8787/test-post/llm/
```

### Environment Variables (Development)

Create `.dev.vars` for local secrets (git-ignored):

```ini
API_KEYS=test_key_32_chars_minimum_abc123
RECEIPT_KEY=dev_hmac_secret_32_bytes_minimum
```

### Testing Checklist

- [ ] Sitemap returns valid JSON array
- [ ] Machine endpoints return proper Link headers
- [ ] HEAD requests work (no body returned)
- [ ] GET with If-None-Match returns 304 when ETag matches
- [ ] API key authentication works (if enabled)
- [ ] Usage receipts have valid HMAC signatures (if enabled)
- [ ] Policy links present in Link headers (if configured)
- [ ] 404 for invalid paths

## Deployment

### Staging

```bash
wrangler deploy --env staging
```

### Production

```bash
# Final checks
- [ ] Secrets set via wrangler secret put
- [ ] Routes configured correctly
- [ ] Rate limiting enabled
- [ ] SSL/TLS mode: Full (strict)
- [ ] Always Use HTTPS enabled
- [ ] Tested with staging first

# Deploy
wrangler deploy --env production
```

### Rollback

```bash
# List deployments
wrangler deployments list

# Rollback to previous version
wrangler rollback [deployment-id]
```

## Monitoring

### Cloudflare Analytics

- Worker requests/sec
- 200 vs 304 response ratio (should be ~10% / 90%)
- Error rate (5xx responses)
- Latency percentiles (p50, p95, p99)

### Logs

```bash
# Stream live logs
wrangler tail

# Filter by status code
wrangler tail --status 304

# Filter by sampling rate
wrangler tail --sampling-rate 0.1
```

### Alerts

Configure Cloudflare alerts for:
- Error rate spike (>5% 5xx responses)
- Traffic surge (10x normal requests)
- Worker CPU time exceeded

## Troubleshooting

### Common Issues

**304 responses not working:**
- Check origin sends `ETag` header
- Verify worker respects `ETag` (pass through)
- Ensure `If-None-Match` header properly formatted

**API authentication failing:**
- Verify `API_KEYS` secret set correctly
- Check comma-separated format (no spaces)
- Ensure keys are 32+ characters

**Usage receipts invalid:**
- Confirm `RECEIPT_KEY` matches origin server
- Verify HMAC algorithm (HMAC-SHA256)
- Check timestamp format (Unix epoch)

**HEAD requests failing:**
- Ensure origin supports HEAD (or worker falls back to GET)
- Verify no body returned on HEAD response

## License

MIT License - See [LICENSE](LICENSE)

## Patent Notice

This worker implements methods covered by **US Patent Application 63/895,763** (filed October 8, 2025, status: Patent Pending).

**For Website Owners:** FREE to use under MIT license for your own infrastructure.

**For Commercial Use at Scale:** Large-scale deployments (>10,000 URLs/month) may require separate patent licensing. Contact: antunjurkovic@gmail.com

See [PATENTS.md](../wordpress/trusted-collab-tunnel/PATENTS.md) in the WordPress plugin for full patent licensing details.

## Resources

- **Full Specification:** https://github.com/antunjurkovic-collab/collab-tunnel-spec
- **WordPress Plugin:** https://github.com/antunjurkovic-collab/trusted-collab-tunnel
- **Protocol Validator:** https://llmpages.org/validator/
- **Documentation:** https://llmpages.org/developers/

## Support

- **GitHub Issues:** https://github.com/antunjurkovic-collab/trusted-collab-worker/issues
- **Security:** See [SECURITY.md](SECURITY.md) for responsible disclosure
- **Email:** antunjurkovic@gmail.com

---

**Last Updated:** October 19, 2025
**Version:** 0.9.0-beta
