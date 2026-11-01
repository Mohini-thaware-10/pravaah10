const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';

const PAGES = [
  'overview', 'approval-dashboard', 'applications', 'workflow-tracking',
  'document-verification', 'compliance-monitoring', 'deadline-alerts',
  'reports-analytics', 'approval-to-compliance', 'approval-stages',
  'audit-trail', 'user-role-management', 'pre-submission-simulator',
  'trace-graph', 'impact-map', 'help', 'settings'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getTargets() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(DEBUG + '/json');
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error('No chrome target');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error'));
  });
}

let idc = 0;
function send(ws, method, params = {}) {
  const id = ++idc;
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(method + ': ' + msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const errors = [];
let currentPage = 'load';

function record(kind, text) {
  errors.push({ page: currentPage, kind, text: String(text).slice(0, 300) });
}

async function main() {
  const target = await getTargets();
  const ws = await connect(target.webSocketDebuggerUrl);

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      record('exception', (d.exception && (d.exception.description || d.exception.value)) || d.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      record('console.error', msg.params.args.map(a => a.value || a.description || a.type).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      record('log.error', msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');

  currentPage = 'load';
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(3500);

  const results = [];
  for (const p of PAGES) {
    currentPage = p;
    const clickExpr = `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(!el) return 'NO_NAV'; el.click(); return 'OK';})()`;
    let clickRes;
    try {
      clickRes = await send(ws, 'Runtime.evaluate', { expression: clickExpr, returnByValue: true });
    } catch (e) {
      clickRes = { result: { value: 'EVAL_FAIL' } };
    }
    await sleep(500);
    const checkExpr = `(function(){var pg=document.getElementById('page-${p}'); if(!pg) return JSON.stringify({exists:false}); return JSON.stringify({exists:true, active:pg.classList.contains('active'), len:pg.innerHTML.length, text:pg.innerText.slice(0,80).replace(/\\s+/g,' ')});})()`;
    const check = await send(ws, 'Runtime.evaluate', { expression: checkExpr, returnByValue: true });
    let info;
    try { info = JSON.parse(check.result.value); } catch { info = { raw: check.result.value }; }
    results.push({ page: p, nav: clickRes.result.value, ...info });
  }

  // Test sidebar collapse
  currentPage = 'collapse';
  const collapse = await send(ws, 'Runtime.evaluate', { expression: `(function(){var b=document.getElementById('sidebarCollapse'); var s=document.getElementById('sidebar'); if(!b||!s) return 'MISSING'; var before=s.classList.contains('collapsed'); b.click(); var after=s.classList.contains('collapsed'); b.click(); return 'before='+before+' afterClick='+after;})()`, returnByValue: true });

  // Test global search overlay open
  currentPage = 'search';
  const search = await send(ws, 'Runtime.evaluate', { expression: `(function(){var b=document.querySelector('[id*="earch"]'); return b?b.id:'none';})()`, returnByValue: true });

  console.log('=== PAGE RESULTS ===');
  for (const r of results) {
    console.log(`${r.page.padEnd(26)} nav=${r.nav} exists=${r.exists} active=${r.active} len=${r.len} :: ${r.text || r.raw || ''}`);
  }
  console.log('=== COLLAPSE ===');
  console.log(collapse.result.value);
  console.log('=== SEARCH ELEMENT ===');
  console.log(search.result.value);
  console.log('=== ERRORS (' + errors.length + ') ===');
  for (const e of errors) {
    console.log(`[${e.page}] ${e.kind}: ${e.text}`);
  }
  await sleep(200);
  ws.close();
}

main().then(() => process.exit(0)).catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
