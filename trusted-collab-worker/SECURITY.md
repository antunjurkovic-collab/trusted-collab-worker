# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.9.x   | :white_check_mark: |
| < 0.9   | :x:                |

## Security Considerations

### Key Management (Cloudflare Secrets)

**API Keys:**
- Store in Cloudflare Worker secrets (NOT in code or wrangler.toml)
- Use `wrangler secret put API_KEYS` to set securely
- Rotate regularly (recommend every 90 days)
- Minimum 32 characters, cryptographically random

**HMAC Secret:**
- `RECEIPT_KEY` must be stored as Cloudflare secret
- Minimum 32 bytes (256 bits)
- Never commit to version control
- Same key as origin server (for receipt verification)

**Environment Variables vs Secrets:**
- Public URLs (`TERMS_URL`, `PRICING_URL`): Can use env vars
- Sensitive data (`API_KEYS`, `RECEIPT_KEY`): MUST use secrets

**Example:**
```bash
# Safe (public URLs)
wrangler publish --env production

# Required for sensitive data
wrangler secret put API_KEYS
wrangler secret put RECEIPT_KEY
```

### Rate Limiting

**Recommendations:**
- Enable Cloudflare Rate Limiting rules for:
  - `/llm-sitemap.json`: Max 60 requests/minute per IP
  - `/{canonical}/llm/`: Max 120 requests/minute per IP
- Use Cloudflare WAF to block abusive patterns
- Monitor for DDoS attacks on sitemap endpoint

**Worker-Level:**
- Consider implementing per-IP rate limiting in worker
- Use Cloudflare Durable Objects for distributed rate limiting
- Return `429 Too Many Requests` when exceeded

### Logging and Redaction

**What to Log:**
- Request method, path, status code
- ETag matches/misses
- 304 vs 200 response rates
- Authentication failures (API key invalid)

**What NOT to Log:**
- API keys (even partial or hashed)
- HMAC secrets
- Full receipt data (contains metadata)
- User IP addresses (GDPR consideration)

**Cloudflare Logpush:**
- Configure logpush with sensitive field redaction
- Use Cloudflare Analytics for aggregate metrics

### Receipt Data Minimization

**Receipt Contents:**
- Contract ID, HTTP status, bytes, ETag, timestamp, HMAC signature
- Contains metadata about request

**Best Practices:**
- Only enable receipts when required for billing/analytics
- Receipts should be short-lived (consumed by client, not stored)
- HMAC prevents tampering but receipts still leak metadata

**Privacy:**
- Receipts may reveal:
  - Fetch frequency (timestamp)
  - Content size (bytes)
  - Cache hit rate (status)
- Consider privacy policy implications

### Caching Behavior

**DO:**
- Respect origin `ETag` header (pass through)
- Respect origin `Cache-Control` directives
- Cache 304 Not Modified responses (no body)
- Set `Vary: Accept` if content negotiation used

**DO NOT:**
- Cache usage receipts (always unique timestamp/signature)
- Strip `ETag` headers from origin
- Return body on 304 responses (violates HTTP semantics)
- Cache responses with `Cache-Control: no-store`

**Cloudflare Cache API:**
```javascript
// Correct: Cache based on ETag
const cacheKey = new Request(url, {
  headers: { 'If-None-Match': etag }
});

// Incorrect: Don't cache receipts
if (response.headers.has('AI-Usage-Receipt')) {
  return response; // Don't cache
}
```

### HEAD Request Handling

**Support:**
- Worker should support HEAD requests
- Return same headers as GET, but no body
- Fall back to GET if origin doesn't support HEAD

**Implementation:**
```javascript
if (request.method === 'HEAD') {
  const getRequest = new Request(request.url, {
    method: 'GET',
    headers: request.headers
  });
  const response = await fetch(getRequest);
  return new Response(null, {
    status: response.status,
    headers: response.headers
  });
}
```

### Link Header Parsing

**Security Risks:**
- Malformed Link headers could cause parsing errors
- Duplicate relations should be suppressed
- Only first canonical link should be used

**Mitigations:**
- Validate Link header format
- Use strict parsing (reject malformed headers)
- Limit number of Link relations processed (max 10)

**Example:**
```javascript
// Secure parsing
function parseLink(linkHeader) {
  if (!linkHeader || linkHeader.length > 2000) return null;
  // Parse only first canonical link
  const match = linkHeader.match(/<([^>]+)>;\s*rel="?canonical"?/);
  return match ? match[1] : null;
}
```

### If-None-Match Handling

**ETag Quoting:**
- Handle both quoted (`"abc123"`) and bare (`abc123`) ETags
- Normalize before comparison
- Weak ETags (`W/"abc"`) require special handling

**Multi-Value:**
- `If-None-Match: "etag1", "etag2"` should match any
- Parse comma-separated values correctly

**Example:**
```javascript
function normalizeETag(etag) {
  if (!etag) return '';
  return etag.replace(/^W\//, '').replace(/^"|"$/g, '');
}

function matchesETag(ifNoneMatch, currentETag) {
  if (!ifNoneMatch || !currentETag) return false;
  const normalized = normalizeETag(currentETag);
  return ifNoneMatch.split(',').some(tag =>
    normalizeETag(tag.trim()) === normalized
  );
}
```

### CORS and Cross-Origin Requests

**Considerations:**
- Machine endpoints may be fetched cross-origin
- Set appropriate CORS headers if needed
- Validate `Origin` header to prevent abuse

**Example:**
```javascript
// Allow specific origins only
const allowedOrigins = ['https://example.com'];
const origin = request.headers.get('Origin');
if (origin && allowedOrigins.includes(origin)) {
  response.headers.set('Access-Control-Allow-Origin', origin);
}
```

### Origin Server Trust

**Assumptions:**
- Worker trusts origin server's ETag values
- Origin is responsible for content integrity
- Man-in-the-middle between worker and origin could tamper

**Mitigations:**
- Use HTTPS for origin fetch (TLS required)
- Verify origin certificate (Cloudflare does this)
- Consider HMAC signing of ETags if extreme paranoia

### DDoS and Abuse Protection

**Cloudflare Features:**
- Enable "Under Attack Mode" if abused
- Use Bot Fight Mode for automated traffic
- Configure firewall rules for known-good bots

**Worker-Level:**
- Implement request validation (reject malformed)
- Set reasonable timeouts (max 30s)
- Return early for invalid requests (don't fetch origin)

### Error Handling

**Information Disclosure:**
- Don't expose internal errors to clients
- Return generic 500 errors, log details internally
- Don't reveal origin server details

**Example:**
```javascript
try {
  const response = await fetch(origin);
  return response;
} catch (err) {
  console.error('Origin fetch failed:', err);
  return new Response('Internal Server Error', {
    status: 500
  });
}
```

### Server Configuration

**Cloudflare Settings:**
- Enable Always Use HTTPS
- Enable Automatic HTTPS Rewrites
- Configure SSL/TLS mode: Full (strict)
- Enable HTTP/2 and HTTP/3

**Worker Routes:**
- Scope routes narrowly (`example.com/llm*`)
- Don't wildcard entire domain unless necessary
- Review route priority (most specific first)

## Reporting a Vulnerability

**If you discover a security vulnerability, please:**

1. **DO NOT** open a public GitHub issue
2. **DO NOT** disclose the vulnerability publicly until patched

**Instead, contact:**
- **Email:** antunjurkovic@gmail.com
- **Subject:** "SECURITY: TCT Cloudflare Worker Vulnerability"
- **Include:**
  - Description of the vulnerability
  - Steps to reproduce
  - Affected versions
  - Potential impact
  - Your name/handle (for credit, optional)

**What to Expect:**
1. **Acknowledgment** within 48 hours
2. **Initial assessment** within 5 business days
3. **Coordinated disclosure** timeline (typically 90 days)
4. **Security patch** released before public disclosure
5. **Credit** in release notes and security advisory (if desired)

**Severity Levels:**
- **Critical:** Remote code execution, secret exposure, origin bypass
- **High:** Authentication bypass, DoS, cache poisoning
- **Medium:** Information disclosure, header injection
- **Low:** Configuration issues, low-impact bugs

**Bug Bounty:**
- No formal bug bounty program at this time
- Credit and acknowledgment provided for valid reports
- May offer compensation for critical vulnerabilities (case-by-case)

## Security Updates

**How to Stay Informed:**
- Watch this repository for security releases
- Follow [@antunjurkovic-collab](https://github.com/antunjurkovic-collab) on GitHub

**Security Advisories:**
- Published via GitHub Security Advisories
- Included in CHANGELOG.md

## Responsible Disclosure Timeline

1. **Day 0:** Vulnerability reported privately
2. **Day 1-2:** Acknowledgment sent to reporter
3. **Day 3-7:** Vulnerability assessed and confirmed
4. **Day 8-30:** Patch developed and tested
5. **Day 31-45:** Patch released (version bump)
6. **Day 46-90:** Public disclosure (coordinated with reporter)

**Exceptions:**
- **Critical vulnerabilities:** Expedited timeline (7-14 days)
- **Already public:** Immediate patch release
- **Actively exploited:** Emergency patch within 48 hours

## Past Security Issues

None reported as of October 19, 2025.

## Security Hardening Checklist

**Before Production:**
- [ ] All secrets stored in Cloudflare Secrets (not env vars)
- [ ] API keys strong (32+ characters, random)
- [ ] HMAC key matches origin server
- [ ] Rate limiting configured (Cloudflare dashboard)
- [ ] Always Use HTTPS enabled
- [ ] SSL/TLS mode: Full (strict)
- [ ] Bot Fight Mode enabled
- [ ] Firewall rules configured
- [ ] Logpush configured with sensitive field redaction
- [ ] Worker routes scoped appropriately
- [ ] Tested with staging origin first
- [ ] Monitoring/alerts configured

---

**Last Updated:** October 19, 2025

For general support (non-security), please use [GitHub Issues](https://github.com/antunjurkovic-collab/trusted-collab-worker/issues).
