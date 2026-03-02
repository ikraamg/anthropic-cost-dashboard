// Cloudflare Pages Function — proxies /v1/* requests to api.anthropic.com
// The API key travels: browser → this worker → Anthropic (never exposed to third parties)

const ALLOWED_HEADERS = ['anthropic-version', 'anthropic-beta', 'x-api-key', 'content-type'];

export async function onRequest(context) {
    const { request } = context;

    // Only allow GET (usage reports are GET requests)
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
            },
        });
    }

    if (request.method !== 'GET') {
        return Response.json({ error: { message: 'Only GET allowed' } }, { status: 405 });
    }

    // Build upstream URL
    const url = new URL(request.url);
    const upstream = `https://api.anthropic.com${url.pathname}${url.search}`;

    // Forward only safe headers
    const headers = new Headers();
    for (const key of ALLOWED_HEADERS) {
        const val = request.headers.get(key);
        if (val) headers.set(key, val);
    }

    try {
        const resp = await fetch(upstream, { method: 'GET', headers });

        return new Response(resp.body, {
            status: resp.status,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        return Response.json(
            { error: { message: `Proxy error: ${err.message}` } },
            { status: 502 }
        );
    }
}
