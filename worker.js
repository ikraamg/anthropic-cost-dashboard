// Cloudflare Worker — proxies /v1/* to api.anthropic.com, serves static assets for everything else

const ALLOWED_HEADERS = ['anthropic-version', 'anthropic-beta', 'x-api-key', 'content-type'];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Proxy /v1/* to Anthropic API
        if (url.pathname.startsWith('/v1/')) {
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

            const headers = new Headers();
            for (const key of ALLOWED_HEADERS) {
                const val = request.headers.get(key);
                if (val) headers.set(key, val);
            }

            try {
                const upstream = `https://api.anthropic.com${url.pathname}${url.search}`;
                const resp = await fetch(upstream, { method: 'GET', headers });
                return new Response(resp.body, {
                    status: resp.status,
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                });
            } catch (err) {
                return Response.json({ error: { message: `Proxy error: ${err.message}` } }, { status: 502 });
            }
        }

        // Everything else → static assets
        return env.ASSETS.fetch(request);
    },
};
