// Tiny proxy that serves the dashboard and forwards API calls to Anthropic.
// Run with: node serve.js
// Then open: http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3010;

http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
        });
        return res.end();
    }

    // Proxy /v1/* to Anthropic
    if (req.url.startsWith('/v1/')) {
        const fwd = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (!['host', 'connection', 'origin', 'referer'].includes(k)) fwd[k] = v;
        }

        try {
            const apiRes = await fetch('https://api.anthropic.com' + req.url, { headers: fwd });
            const body = await apiRes.text();
            res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
            res.end(body);
        } catch (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: err.message } }));
        }
        return;
    }

    // Serve static files (dashboard HTML)
    const file = req.url === '/' ? 'index.html' : req.url.slice(1);
    try {
        const content = fs.readFileSync(path.join(__dirname, file));
        const ext = path.extname(file);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}).listen(PORT, () => console.log(`\n  Dashboard → http://localhost:${PORT}\n`));
