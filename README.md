# Trusted Collaboration Tunnel - Cloudflare Worker

Edge-layer proxy for the Trusted Collaboration Tunnel (TCT) protocol. Adds header injection, authentication, and usage receipt signing at the Cloudflare edge.

## Features

- ✅ **Canonical Link Injection** - Automatically adds `Link: <C-URL>; rel="canonical"` header if missing
- ✅ **Policy Links** - Injects terms/pricing Link headers for AI policy discoverability
- ✅ **Edge Authentication** - Optional API key validation (Bearer token or X-API-Key header)
- ✅ **Usage Receipt Signing** - HMAC-SHA256 signed `AI-Usage-Receipt` headers on 200/304 responses
- ✅ **Zero Dependencies** - Pure Cloudflare Workers runtime (Web Crypto API only)
- ✅ **Pass-Through Mode** - Forwards all traffic to origin WordPress site

## Requirements

- Cloudflare account (free tier works)
- WordPress site with TCT plugin installed (generates M-URLs and sitemap)
- Wrangler CLI (optional, for local development)

## Quick Start

### 1. Deploy to Cloudflare

**Option A: Cloudflare Dashboard (No CLI)**
1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker
2. Name it `tct-worker`
3. Copy-paste the contents of `trusted-collab-worker.js`
4. Click **Deploy**

**Option B: Wrangler CLI**
```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
wrangler deploy
```

### 2. Add Route

1. Go to Workers & Pages → `tct-worker` → Triggers → Add Route
2. Route pattern: `*yourdomain.com/llm*`
3. Zone: Select your site
4. Save

**Additional routes (recommended):**
- `*yourdomain.com/llm-sitemap.json`
- `*yourdomain.com/llms.txt`
- `*yourdomain.com/llm-stats.json`
- `*yourdomain.com/llm-changes.json`

### 3. Configure Environment Variables

Go to Workers & Pages → `tct-worker` → Settings → Variables

#### Required: None (Worker works in pass-through mode)

#### Optional Authentication:
```
AUTH_MODE = api_key
API_KEYS = key1,key2,key3
```

#### Optional Policy Links:
```
TERMS_URL = https://yourdomain.com/ai-policy
PRICING_URL = https://yourdomain.com/ai-pricing
```

#### Optional Usage Receipts:
```
RECEIPT_HMAC_KEY = your-secret-key-here
```

#### Optional Path Overrides:
```
SITEMAP_PATH = /llm-sitemap.json
MANIFEST_PATH = /llms.txt
```

### 4. Test

```bash
# Test canonical injection
curl -I https://yourdomain.com/your-post/llm/
# Should see: Link: <https://yourdomain.com/your-post/>; rel="canonical"

# Test authentication (if enabled)
curl -I -H "Authorization: Bearer key1" https://yourdomain.com/your-post/llm/
# Should return: 200 OK

curl -I https://yourdomain.com/your-post/llm/
# Should return: 401 Unauthorized (no key provided)

# Test usage receipts (if enabled)
curl -sI -H "X-AI-Contract: test-pilot-2025" https://yourdomain.com/your-post/llm/ | grep AI-Usage-Receipt
# Should see: AI-Usage-Receipt: contract=test-pilot-2025; status=200; bytes=4827; etag="sha256-..."; ts=2025-10-16T...; sig=...
```

## Configuration Details

### Authentication Modes

**Off (Default):**
```
# No AUTH_MODE variable set
# All requests pass through to origin
```

**API Key:**
```
AUTH_MODE = api_key
API_KEYS = partner1-key,partner2-key,dev-key
```

Clients must include one of:
- `Authorization: Bearer partner1-key` (preferred)
- `X-API-Key: partner1-key` (fallback)

Failed auth returns `401 Unauthorized` with `WWW-Authenticate: Bearer realm="tct"`.

### Policy Links

Automatically injects HTTP Link headers on M-URL responses:

```
TERMS_URL = https://yourdomain.com/ai-policy
PRICING_URL = https://yourdomain.com/ai-pricing
```

Result:
```http
Link: <https://yourdomain.com/your-post/>; rel="canonical"
Link: <https://yourdomain.com/ai-policy>; rel="terms-of-service"
Link: <https://yourdomain.com/ai-pricing>; rel="payment"
```

AI crawlers discover your terms and pricing automatically.

### Usage Receipts

Enable signed receipts to track AI crawler usage:

```
RECEIPT_HMAC_KEY = your-secret-hmac-key-256-bits
```

**How it works:**
1. AI crawler sends `X-AI-Contract: pilot-2025Q4` header
2. Worker responds with signed receipt:
   ```
   AI-Usage-Receipt: contract=pilot-2025Q4; status=200; bytes=4827; etag="sha256-abc123"; ts=2025-10-16T12:34:56Z; sig=xyz...
   ```
3. Signature = HMAC-SHA256(payload, secret key)

**Receipt includes:**
- `contract` - Contract ID from request header
- `status` - HTTP response code (200 or 304)
- `bytes` - Response body size (0 for 304)
- `etag` - Content hash (for change detection)
- `ts` - ISO 8601 timestamp
- `sig` - Base64-encoded HMAC-SHA256 signature

**Verification (Python):**
```python
import hmac, hashlib, base64

def verify_receipt(header_value, secret_key):
    parts = dict([x.split('=', 1) for x in header_value.split(';')])
    payload = f"contract={parts['contract']}; status={parts['status']}; bytes={parts['bytes']}; etag={parts['etag']}; ts={parts['ts']}"
    expected_sig = base64.b64encode(
        hmac.new(secret_key.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode()
    return expected_sig == parts['sig']
```

## Architecture

### Request Flow

```
AI Crawler → Cloudflare Edge (Worker) → Origin (WordPress + TCT Plugin) → Cloudflare → AI Crawler
```

**Worker Actions:**
1. **Auth Check** (if enabled) - Validate API key, return 401 if invalid
2. **Forward to Origin** - Pass request to WordPress origin
3. **Receive Origin Response** - Get response from TCT plugin
4. **Header Injection:**
   - Add `Link: rel="canonical"` if missing
   - Add policy links (terms/pricing) if configured
   - Compute and sign usage receipt if configured
5. **Return Modified Response** - Send to crawler with injected headers

### Why Use This Worker?

**Without Worker (WordPress Plugin Only):**
- ✅ Core TCT functionality works
- ❌ No edge-layer authentication
- ❌ Receipt signing happens at origin (extra compute)
- ❌ Policy links require PHP header injection

**With Worker (Edge + Origin):**
- ✅ All core TCT functionality
- ✅ Authentication at edge (blocks bad requests before hitting origin)
- ✅ Receipt signing at edge (offloads origin CPU)
- ✅ Policy links injected at edge (no PHP changes needed)
- ✅ Canonical link fallback (if origin forgets to add it)

## Performance Impact

- **Minimal latency:** <5ms added (HMAC signing only)
- **Zero origin offload:** Worker forwards requests to origin
- **Edge caching friendly:** Preserves all cache headers from origin
- **No body transformation:** Pass-through mode (body not parsed)

## Security

### Best Practices

1. **Rotate HMAC keys regularly** (quarterly recommended)
2. **Use strong API keys** (32+ characters, random)
3. **Don't commit secrets to git** - Use Wrangler secrets:
   ```bash
   wrangler secret put RECEIPT_HMAC_KEY
   wrangler secret put API_KEYS
   ```
4. **Monitor 401 rates** - High 401s = key leakage or brute force
5. **Rate limiting** - Use Cloudflare WAF rules to rate-limit `/llm/*` endpoints

### Cloudflare WAF Rules

**Allow GET/HEAD only:**
```
(http.request.uri.path matches "^/llm" and http.request.method ne "GET" and http.request.method ne "HEAD")
→ Block
```

**Rate limit:**
```
(http.request.uri.path matches "^/llm")
→ Rate Limit: 100 requests/minute per IP
```

## Troubleshooting

### Worker not executing

**Check:**
1. Route is configured: `*yourdomain.com/llm*`
2. Zone matches your site
3. Worker is deployed (not draft)

### 401 Unauthorized (unexpected)

**Check:**
1. `AUTH_MODE` variable is set correctly
2. `API_KEYS` contains valid keys (comma-separated, no spaces)
3. Client is sending `Authorization: Bearer <key>` or `X-API-Key: <key>`
4. Key matches exactly (case-sensitive)

### Receipt signature verification fails

**Check:**
1. `RECEIPT_HMAC_KEY` matches between Worker and verification script
2. Payload string format is exact (including spaces, quotes around etag)
3. No URL encoding/decoding issues
4. Client and server using same hash algorithm (SHA-256)

### Origin not responding

**Check:**
1. WordPress TCT plugin is active
2. Origin URL is accessible: `curl https://yourdomain.com/test-post/llm/`
3. Cloudflare DNS is proxied (orange cloud)
4. Origin firewall allows Cloudflare IPs

## Local Development

### Prerequisites
```bash
npm install -g wrangler
wrangler login
```

### Run Locally
```bash
# Create wrangler.toml (if not exists)
cat > wrangler.toml << EOF
name = "tct-worker"
main = "trusted-collab-worker.js"
compatibility_date = "2024-10-01"

[vars]
AUTH_MODE = "api_key"
API_KEYS = "test-key"
TERMS_URL = "https://example.com/terms"
PRICING_URL = "https://example.com/pricing"
RECEIPT_HMAC_KEY = "test-secret"
EOF

# Start dev server
wrangler dev
```

Test locally:
```bash
curl http://localhost:8787/test/llm/ -H "Authorization: Bearer test-key"
```

## Deployment

### Production Deploy
```bash
# Set secrets (not in wrangler.toml)
wrangler secret put RECEIPT_HMAC_KEY
wrangler secret put API_KEYS

# Deploy
wrangler deploy

# Verify
wrangler tail  # Live logs
```

### CI/CD (GitHub Actions)

```yaml
name: Deploy TCT Worker
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          secrets: |
            RECEIPT_HMAC_KEY
            API_KEYS
        env:
          RECEIPT_HMAC_KEY: ${{ secrets.RECEIPT_HMAC_KEY }}
          API_KEYS: ${{ secrets.API_KEYS }}
```

## Cost Estimation

**Cloudflare Workers Pricing (as of 2025):**
- Free tier: 100,000 requests/day
- Paid: $5/month for 10M requests

**Example site (20,000 AI requests/month):**
- Cost: **$0** (well within free tier)

**High-traffic site (10M AI requests/month):**
- Cost: **$5/month** (paid tier)
- Savings from TCT: $500-5,000/month (egress reduction)
- **Net savings: 99%+ cost reduction**

## License

MIT License - See [LICENSE](../wordpress/trusted-collab-tunnel/LICENSE)

## Related

- **WordPress Plugin:** `../wordpress/trusted-collab-tunnel/`
- **Live Demo:** https://llmpages.org
- **Validator:** https://llmpages.org/validator/
- **Patent Application:** US 63/895,763 (October 8, 2025)

## Support

- GitHub Issues: https://github.com/antunjurkovic-collab/trusted-collab-worker/issues
- Documentation: https://llmpages.org/integration-guide
- Email: antunjurkovic@gmail.com

---

**Built for the Trusted Collaboration Tunnel protocol** - Making AI crawling efficient, transparent, and respectful.
