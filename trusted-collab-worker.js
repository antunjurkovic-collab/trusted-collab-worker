export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const isLLMEndpoint = /\/llm\/?$/.test(pathname);
    const isSitemap = pathname === (env.SITEMAP_PATH || '/llm-sitemap.json');
    const isManifest = pathname === (env.MANIFEST_PATH || '/llms.txt');

    // Optional auth for llm endpoints
    if (isLLMEndpoint && (env.AUTH_MODE === 'api_key')) {
      const auth = request.headers.get('authorization') || '';
      const xKey = request.headers.get('x-api-key') || '';
      const keys = (env.API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
      const ok = (bearer && keys.includes(bearer)) || (xKey && keys.includes(xKey));
      if (!ok) {
        return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="tct"' } });
      }
    }

    // Forward to origin
    let resp = await fetch(request);
    const headers = new Headers(resp.headers);

    // Normalize headers for LLM endpoints, sitemap, and manifest
    if (isLLMEndpoint || isSitemap || isManifest) {
      // Set CDN-friendly Cache-Control (override origin to ensure correct caching)
      headers.set('Cache-Control', 'max-age=0, must-revalidate, stale-while-revalidate=60, stale-if-error=86400, public');

      // Clean up origin cache headers that interfere with CDN caching
      headers.delete('Pragma');
      headers.delete('Expires');
      headers.delete('X-LiteSpeed-Cache-Control');
    }

    // Inject canonical Link on llm endpoints if missing
    if (isLLMEndpoint) {
      let link = headers.get('Link') || '';
      const hasCanonical = /;\s*rel=\"?canonical\"?/i.test(link);
      if (!hasCanonical) {
        // Compute canonical by stripping /llm/
        const cPath = pathname.replace(/\/?llm\/?$/, '/');
        const cUrl = `${url.protocol}//${url.host}${cPath}`;
        headers.append('Link', `<${cUrl}>; rel="canonical"`);
      }
      // Policy links (IANA-registered relation types) - only if not already present
      // Re-read Link header after potential canonical addition
      link = headers.get('Link') || '';
      if (env.TERMS_URL && !/;\s*rel=\"?terms/i.test(link)) {
        headers.append('Link', `<${env.TERMS_URL}>; rel="terms-of-service"`);
      }
      if (env.PRICING_URL && !/;\s*rel=\"?p(ricing|ayment)/i.test(link)) {
        headers.append('Link', `<${env.PRICING_URL}>; rel="payment"`);
      }
    }

    // Usage receipt (optional)
    if (isLLMEndpoint && env.RECEIPT_HMAC_KEY) {
      let status = resp.status;
      let bytes = 0;
      if (status === 304) {
        bytes = 0;
      } else if (status === 200) {
        const cl = headers.get('Content-Length');
        if (cl) {
          bytes = parseInt(cl, 10) || 0;
        } else {
          // Buffer the body to measure (MVP); for large bodies, consider a tee stream
          const buf = await resp.clone().arrayBuffer();
          bytes = buf.byteLength;
        }
      }
      const etag = headers.get('ETag')?.replace(/\r|\n/g, '') || '';
      const contract = request.headers.get('X-AI-Contract') || '';
      const ts = new Date().toISOString();
      const payload = `contract=${contract}; status=${status}; bytes=${bytes}; etag="${etag.replace(/"/g,'') }"; ts=${ts}`;
      const sig = await hmacB64(payload, env.RECEIPT_HMAC_KEY);
      headers.set('AI-Usage-Receipt', `${payload}; sig=${sig}`);
    }

    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
  }
}

async function hmacB64(payload, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payload));
  // base64
  let bin = '';
  const bytes = new Uint8Array(sigBuf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Suggested env vars:
// AUTH_MODE=api_key
// API_KEYS=key1,key2
// TERMS_URL=https://example.com/ai-policy
// PRICING_URL=https://example.com/ai-pricing
// RECEIPT_HMAC_KEY=supersecret
// SITEMAP_PATH=/llm-sitemap.json
// MANIFEST_PATH=/llms.txt

