    // NOTE: Update pricing as Anthropic changes rates.
    // Prices are per million tokens. Source: https://docs.anthropic.com/en/docs/about-claude/pricing
    const MODEL_PRICING = {
        'claude-opus-4-6':       { input: 5.00,  output: 25.00 },
        'claude-sonnet-4-6':     { input: 3.00,  output: 15.00 },
        'claude-haiku-4-5':      { input: 1.00,  output: 5.00  },
        'claude-sonnet-4-5':     { input: 3.00,  output: 15.00 },
        'claude-opus-4-0':       { input: 15.00, output: 75.00 },
        'claude-sonnet-4-0':     { input: 3.00,  output: 15.00 },
        'claude-3-5-sonnet':     { input: 3.00,  output: 15.00 },
        'claude-3-5-haiku':      { input: 0.80,  output: 4.00  },
        'claude-3-opus':         { input: 15.00, output: 75.00 },
        'claude-3-sonnet':       { input: 3.00,  output: 15.00 },
        'claude-3-haiku':        { input: 0.25,  output: 1.25  },
    };

    const CACHE_READ_MULT  = 0.1;   // 90% cheaper than base input
    const CACHE_WRITE_MULT = 1.25;  // 25% premium over base input
    const BATCH_DISCOUNT   = 0.5;

    // === State ===
    let chart    = null;
    let rawData  = [];
    let sortCol  = 'cost';
    let sortDir  = -1; // descending by cost

    // === Init ===
    (function init() {
        const now = new Date();
        const ago = new Date(now);
        ago.setDate(ago.getDate() - 7);
        ago.setHours(0, 0, 0, 0);

        document.getElementById('startDate').value = fmtDateInput(ago);
        document.getElementById('endDate').value   = fmtDateInput(now);

        document.getElementById('toggleKey').addEventListener('click', toggleKey);
        document.getElementById('fetchBtn').addEventListener('click', fetchUsage);
        document.getElementById('exportBtn').addEventListener('click', exportCSV);

        // Enter key on API key input triggers fetch
        document.getElementById('apiKey').addEventListener('keydown', e => {
            if (e.key === 'Enter') fetchUsage();
        });
    })();

    function fmtDateInput(d) {
        return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function p(n) { return String(n).padStart(2, '0'); }

    // Flexible date parsing: "2026-03-01", "2026-03-01 14:30", "Mar 1, 2026", etc.
    function parseDate(str) {
        if (!str || !str.trim()) return null;
        const s = str.trim();
        // Try native Date parsing (handles most formats)
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d;
        // Try replacing space with T for ISO-ish: "2026-03-01 14:00" → "2026-03-01T14:00"
        const d2 = new Date(s.replace(' ', 'T'));
        if (!isNaN(d2.getTime())) return d2;
        return null;
    }

    function toggleKey() {
        const inp = document.getElementById('apiKey');
        const btn = document.getElementById('toggleKey');
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
    }

    // === Pricing Lookup ===
    function getPricing(modelId) {
        if (!modelId) return { input: 3, output: 15 };
        const id = modelId.toLowerCase();
        for (const [key, pr] of Object.entries(MODEL_PRICING)) {
            if (id.includes(key)) return pr;
        }
        // Fallback by family name
        if (id.includes('opus'))   return { input: 15, output: 75 };
        if (id.includes('haiku'))  return { input: 1,  output: 5  };
        return { input: 3, output: 15 };
    }

    // === Cost Calculation ===
    function calcCost(row) {
        const pr   = getPricing(row.model);
        const tier = (row.service_tier || '').toLowerCase();
        const mult = tier === 'batch' ? BATCH_DISCOUNT : 1;

        const inp    = (row.uncached_input_tokens || 0) / 1e6 * pr.input * mult;
        const out    = (row.output_tokens || 0) / 1e6 * pr.output * mult;
        const cRead  = (row.cache_read_input_tokens || 0) / 1e6 * pr.input * CACHE_READ_MULT * mult;
        const cWrite = ((row.ephemeral_5m_input_tokens || 0) + (row.ephemeral_1h_input_tokens || 0))
                       / 1e6 * pr.input * CACHE_WRITE_MULT * mult;

        return { input: inp, output: out, cacheRead: cRead, cacheWrite: cWrite,
                 total: inp + out + cRead + cWrite };
    }

    // === Fetch Data ===
    async function fetchUsage() {
        const apiKey = document.getElementById('apiKey').value.trim();
        if (!apiKey) return setStatus('Enter your Admin API key', true);

        const startParsed = parseDate(document.getElementById('startDate').value);
        const endParsed   = parseDate(document.getElementById('endDate').value);
        const bucket = document.getElementById('bucketWidth').value;
        const group  = document.getElementById('groupBy').value;

        if (!startParsed || !endParsed) return setStatus('Invalid date — try: 2026-03-01 or Mar 1, 2026 14:00', true);

        const params = new URLSearchParams();
        params.set('starting_at',  startParsed.toISOString());
        params.set('ending_at',    endParsed.toISOString());
        params.set('bucket_width', bucket);
        params.append('group_by[]', group);

        // Only send service_tiers filter if user unchecked some (null tiers get excluded otherwise)
        const allTiers = document.querySelectorAll('input[name="tier"]');
        const checkedTiers = document.querySelectorAll('input[name="tier"]:checked');
        if (checkedTiers.length > 0 && checkedTiers.length < allTiers.length) {
            checkedTiers.forEach(c => params.append('service_tiers[]', c.value));
        }

        const btn = document.getElementById('fetchBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Fetching...';
        setStatus('');

        try {
            const headers = { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey };
            if (group === 'speed') headers['anthropic-beta'] = 'fast-mode-2026-02-01';

            // Fetch all pages
            rawData = [];
            let pageUrl = `${apiBase()}/v1/organizations/usage_report/messages?${params}`;
            let page = 1;

            while (pageUrl) {
                setStatus(`Fetching page ${page}...`);
                const resp = await fetch(pageUrl, { headers });

                if (!resp.ok) {
                    const body = await resp.json().catch(() => ({}));
                    throw new Error(body.error?.message || `HTTP ${resp.status}`);
                }

                const json = await resp.json();

                // Flatten nested structure: data[].results[] → flat rows
                for (const bucket of (json.data || [])) {
                    for (const r of (bucket.results || [])) {
                        rawData.push({
                            bucket_start_time: bucket.starting_at,
                            uncached_input_tokens: r.uncached_input_tokens || 0,
                            output_tokens: r.output_tokens || 0,
                            cache_read_input_tokens: r.cache_read_input_tokens || 0,
                            ephemeral_5m_input_tokens: r.cache_creation?.ephemeral_5m_input_tokens || 0,
                            ephemeral_1h_input_tokens: r.cache_creation?.ephemeral_1h_input_tokens || 0,
                            web_search_requests: r.server_tool_use?.web_search_requests || 0,
                            model: r.model,
                            api_key_id: r.api_key_id,
                            workspace_id: r.workspace_id,
                            service_tier: r.service_tier,
                            context_window: r.context_window,
                            inference_geo: r.inference_geo,
                        });
                    }
                }

                // Follow pagination
                if (json.has_more && json.next_page) {
                    const sep = params.toString() ? '&' : '?';
                    pageUrl = `${apiBase()}/v1/organizations/usage_report/messages?${params}&page=${json.next_page}`;
                    page++;
                } else {
                    pageUrl = null;
                }
            }

            if (!rawData.length) {
                setStatus('No data for this range');
                hideResults();
                return;
            }

            setStatus(`${rawData.length} records`);
            showResults();

        } catch (err) {
            setStatus(err.message || 'Request failed', true);
            hideResults();
        } finally {
            btn.disabled = false;
            btn.textContent = 'Fetch Usage';
        }
    }

    // === Render Orchestration ===
    function showResults() {
        document.getElementById('emptyState').style.display   = 'none';
        document.getElementById('summary').style.display      = 'grid';
        document.getElementById('chartSection').style.display  = 'block';
        document.getElementById('tableSection').style.display   = 'block';
        document.getElementById('costLogSection').style.display = 'block';
        renderSummary();
        renderChart();
        renderTable();
        renderCostLog();
    }

    function hideResults() {
        document.getElementById('emptyState').style.display   = 'block';
        document.getElementById('summary').style.display      = 'none';
        document.getElementById('chartSection').style.display  = 'none';
        document.getElementById('tableSection').style.display   = 'none';
        document.getElementById('costLogSection').style.display = 'none';
    }

    // === Summary Cards ===
    function renderSummary() {
        let totalCost = 0, inCost = 0, outCost = 0;
        let totalIn = 0, totalOut = 0, totalCR = 0;

        for (const row of rawData) {
            const c = calcCost(row);
            totalCost += c.total;
            inCost    += c.input;
            outCost   += c.output;
            totalIn   += row.uncached_input_tokens || 0;
            totalOut  += row.output_tokens || 0;
            totalCR   += row.cache_read_input_tokens || 0;
        }

        const s = parseDate(document.getElementById('startDate').value) || new Date();
        const e = parseDate(document.getElementById('endDate').value) || new Date();
        const days = Math.max(1, (e - s) / 864e5);

        document.getElementById('totalCost').textContent  = fmtDollars(totalCost);
        document.getElementById('costSub').textContent    = `~${fmtDollars(totalCost / days)}/day`;

        document.getElementById('totalInput').textContent = fmtNum(totalIn);
        document.getElementById('inputSub').textContent   = `${(totalIn / 1e6).toFixed(2)} MTok · ${fmtDollars(inCost)}`;

        document.getElementById('totalOutput').textContent = fmtNum(totalOut);
        document.getElementById('outputSub').textContent   = `${(totalOut / 1e6).toFixed(2)} MTok · ${fmtDollars(outCost)}`;

        document.getElementById('totalCacheRead').textContent = fmtNum(totalCR);
        const rate = (totalIn + totalCR) > 0
            ? ((totalCR / (totalIn + totalCR)) * 100).toFixed(1) : '0.0';
        document.getElementById('cacheSub').textContent = `${rate}% hit rate`;
    }

    // === Chart ===
    function renderChart() {
        const group = document.getElementById('groupBy').value;
        const buckets = {};
        const groups  = new Set();

        for (const row of rawData) {
            const t = row.bucket_start_time;
            const g = row[group] || 'unknown';
            groups.add(g);
            if (!buckets[t]) buckets[t] = {};
            buckets[t][g] = (buckets[t][g] || 0) + calcCost(row).total;
        }

        const times     = Object.keys(buckets).sort();
        const groupList = [...groups].sort();
        const palette   = ['#d97706','#3b82f6','#22c55e','#ef4444','#8b5cf6',
                           '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];

        const datasets = groupList.map((g, i) => ({
            label: g,
            data: times.map(t => buckets[t][g] || 0),
            backgroundColor: palette[i % palette.length] + 'bb',
            borderColor: palette[i % palette.length],
            borderWidth: 1,
            borderRadius: 2,
        }));

        if (chart) chart.destroy();

        chart = new Chart(document.getElementById('costChart'), {
            type: 'bar',
            data: { labels: times.map(fmtTime), datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${fmtDollars(ctx.raw)}`,
                            footer: items => `Total: ${fmtDollars(items.reduce((s,i) => s + i.raw, 0))}`
                        }
                    },
                    legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 16 } }
                },
                scales: {
                    x: {
                        stacked: true,
                        ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45 },
                        grid:  { color: '#1e1e2e' }
                    },
                    y: {
                        stacked: true,
                        ticks: { color: '#64748b', font: { size: 10 }, callback: v => '$' + v.toFixed(2) },
                        grid:  { color: '#1e1e2e' }
                    }
                }
            }
        });
    }

    // === Table ===
    function renderTable() {
        const group = document.getElementById('groupBy').value;
        const groupLabel = {
            model: 'Model', api_key_id: 'API Key', workspace_id: 'Workspace',
            service_tier: 'Tier', context_window: 'Ctx Window',
            inference_geo: 'Geo', speed: 'Speed'
        }[group] || group;

        const rows = rawData.map(row => ({
            time:        row.bucket_start_time,
            group:       row[group] || 'N/A',
            input:       row.uncached_input_tokens || 0,
            output:      row.output_tokens || 0,
            cache_read:  row.cache_read_input_tokens || 0,
            cache_write: (row.ephemeral_5m_input_tokens || 0) + (row.ephemeral_1h_input_tokens || 0),
            cost:        calcCost(row).total
        }));

        if (sortCol) {
            rows.sort((a, b) => {
                const av = a[sortCol], bv = b[sortCol];
                return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sortDir;
            });
        }

        const cols = [
            { key: 'time',        label: 'Time' },
            { key: 'group',       label: groupLabel },
            { key: 'input',       label: 'Input Tokens',  num: true },
            { key: 'output',      label: 'Output Tokens', num: true },
            { key: 'cache_read',  label: 'Cache Read',    num: true },
            { key: 'cache_write', label: 'Cache Write',   num: true },
            { key: 'cost',        label: 'Est. Cost',     num: true },
        ];

        const arrow = col => sortCol === col ? (sortDir > 0 ? ' ↑' : ' ↓') : '';

        document.getElementById('tableHead').innerHTML =
            '<tr>' + cols.map(c =>
                `<th class="${c.num ? 'num' : ''} ${sortCol === c.key ? 'sorted' : ''}"
                     data-col="${c.key}">${c.label}${arrow(c.key)}</th>`
            ).join('') + '</tr>';

        document.getElementById('tableBody').innerHTML = rows.map(r =>
            `<tr>
                <td>${fmtTime(r.time)}</td>
                <td>${esc(r.group)}</td>
                <td class="num">${fmtNum(r.input)}</td>
                <td class="num">${fmtNum(r.output)}</td>
                <td class="num">${fmtNum(r.cache_read)}</td>
                <td class="num">${fmtNum(r.cache_write)}</td>
                <td class="num" style="color:var(--accent);font-weight:600">${fmtDollars(r.cost)}</td>
            </tr>`
        ).join('');

        // Sortable headers
        document.querySelectorAll('#tableHead th').forEach(th => {
            th.onclick = () => {
                const col = th.dataset.col;
                sortDir = sortCol === col ? sortDir * -1 : 1;
                sortCol = col;
                renderTable();
            };
        });

        document.getElementById('rowCount').textContent = `${rows.length} rows`;
    }

    // === Cost Log with Selection ===
    let logSortCol = 'time';
    let logSortDir = -1;
    let logRows = [];
    let selected = new Set();
    let lastClicked = null;

    function renderCostLog() {
        logRows = rawData.map(row => {
            const c = calcCost(row);
            return {
                time:       row.bucket_start_time,
                model:      row.model || 'N/A',
                input:      c.input,
                output:     c.output,
                cache:      c.cacheRead + c.cacheWrite,
                total:      c.total,
                in_tokens:  row.uncached_input_tokens || 0,
                out_tokens: row.output_tokens || 0,
            };
        });

        if (logSortCol) {
            logRows.sort((a, b) => {
                const av = a[logSortCol], bv = b[logSortCol];
                return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * logSortDir;
            });
        }

        selected.clear();
        lastClicked = null;

        const cols = [
            { key: 'time',       label: 'Timestamp' },
            { key: 'model',      label: 'Model' },
            { key: 'in_tokens',  label: 'Input Tok',   num: true },
            { key: 'out_tokens', label: 'Output Tok',  num: true },
            { key: 'input',      label: 'Input $',     num: true },
            { key: 'output',     label: 'Output $',    num: true },
            { key: 'cache',      label: 'Cache $',     num: true },
            { key: 'total',      label: 'Total Cost',  num: true },
        ];

        const arrow = col => logSortCol === col ? (logSortDir > 0 ? ' ↑' : ' ↓') : '';

        document.getElementById('logHead').innerHTML =
            '<tr>' + cols.map(c =>
                `<th class="${c.num ? 'num' : ''} ${logSortCol === c.key ? 'sorted' : ''}"
                     data-col="${c.key}">${c.label}${arrow(c.key)}</th>`
            ).join('') + '</tr>';

        document.getElementById('logBody').innerHTML = logRows.map((r, i) =>
            `<tr data-idx="${i}">
                <td>${fmtFullTime(r.time)}</td>
                <td>${esc(r.model)}</td>
                <td class="num">${fmtNum(r.in_tokens)}</td>
                <td class="num">${fmtNum(r.out_tokens)}</td>
                <td class="num">${fmtDollars(r.input)}</td>
                <td class="num">${fmtDollars(r.output)}</td>
                <td class="num">${fmtDollars(r.cache)}</td>
                <td class="num" style="color:var(--accent);font-weight:600">${fmtDollars(r.total)}</td>
            </tr>`
        ).join('');

        // Row click → selection
        document.getElementById('logBody').addEventListener('click', handleRowClick);

        // Header sort
        document.querySelectorAll('#logHead th').forEach(th => {
            th.onclick = () => {
                const col = th.dataset.col;
                logSortDir = logSortCol === col ? logSortDir * -1 : -1;
                logSortCol = col;
                renderCostLog();
            };
        });

        document.getElementById('logCount').textContent = `${logRows.length} entries`;
        updateSelectionBar();
    }

    function handleRowClick(e) {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const idx = parseInt(tr.dataset.idx);
        if (isNaN(idx)) return;

        if (e.shiftKey && lastClicked !== null) {
            // Range select
            const lo = Math.min(lastClicked, idx);
            const hi = Math.max(lastClicked, idx);
            for (let i = lo; i <= hi; i++) selected.add(i);
        } else if (e.metaKey || e.ctrlKey) {
            // Toggle single
            selected.has(idx) ? selected.delete(idx) : selected.add(idx);
        } else {
            // Single (clear others)
            selected.clear();
            selected.add(idx);
        }
        lastClicked = idx;
        updateSelectionUI();
    }

    function updateSelectionUI() {
        document.querySelectorAll('#logBody tr').forEach(tr => {
            const idx = parseInt(tr.dataset.idx);
            tr.classList.toggle('selected', selected.has(idx));
        });
        updateSelectionBar();
    }

    function updateSelectionBar() {
        const bar = document.getElementById('selectionBar');
        if (selected.size === 0) {
            bar.classList.remove('visible');
            return;
        }

        let inp = 0, out = 0, cache = 0, total = 0;
        for (const i of selected) {
            const r = logRows[i];
            if (!r) continue;
            inp   += r.input;
            out   += r.output;
            cache += r.cache;
            total += r.total;
        }

        document.getElementById('selCount').textContent = selected.size;
        document.getElementById('selInput').textContent  = fmtDollars(inp);
        document.getElementById('selOutput').textContent = fmtDollars(out);
        document.getElementById('selCache').textContent  = fmtDollars(cache);
        document.getElementById('selTotal').textContent  = fmtDollars(total);
        bar.classList.add('visible');
    }

    function clearSelection() {
        selected.clear();
        lastClicked = null;
        updateSelectionUI();
    }

    function fmtFullTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: 'numeric',
            minute: '2-digit', second: '2-digit', hour12: true
        });
    }

    // === CSV Export ===
    function exportCSV() {
        if (!rawData.length) return setStatus('No data to export', true);

        const group = document.getElementById('groupBy').value;
        const head  = ['Time', group, 'Input Tokens', 'Output Tokens', 'Cache Read', 'Cache Write', 'Est. Cost'];
        const body  = rawData.map(row => [
            row.bucket_start_time,
            row[group] || '',
            row.uncached_input_tokens || 0,
            row.output_tokens || 0,
            row.cache_read_input_tokens || 0,
            (row.ephemeral_5m_input_tokens || 0) + (row.ephemeral_1h_input_tokens || 0),
            calcCost(row).total.toFixed(6)
        ]);

        const csv  = [head, ...body].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `anthropic-usage-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    // === Formatters ===
    function fmtDollars(n) {
        if (n >= 1)    return '$' + n.toFixed(2);
        if (n >= 0.01) return '$' + n.toFixed(4);
        return '$' + n.toFixed(6);
    }

    function fmtNum(n) {
        if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toLocaleString();
    }

    function fmtTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const bw = document.getElementById('bucketWidth').value;
        if (bw === '1d') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (bw === '1h') return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    // Always use relative URLs — both serve.js (local) and Cloudflare Function (prod) proxy to Anthropic
    function apiBase() { return ''; }

    // XSS prevention: escape API response strings before inserting into HTML
    function esc(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function setStatus(msg, err) {
        const el = document.getElementById('status');
        el.textContent = msg;
        el.className = 'status' + (err ? ' error' : '');
    }