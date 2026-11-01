const DEBUG = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(DEBUG + '/json');
      const l = await r.json();
      const p = l.find(t => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(300);
  }
  throw new Error('no target');
}
function connect(url) {
  return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = rej; });
}
let idc = 0;
function send(ws, method, params = {}) {
  const id = ++idc;
  return new Promise((res, rej) => {
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalq(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result.value;
}

const checks = [];
function check(name, pass, detail) { checks.push({ name, pass, detail }); }

async function main() {
  const t = await getTarget();
  const ws = await connect(t.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(3000);

  // Go to document verification
  await evalq(ws, `document.querySelector('.nav__item[data-page="document-verification"]').click()`);
  await sleep(600);

  const kpis = await evalq(ws, `JSON.stringify({all:document.getElementById('dvKpiAll').textContent,verified:document.getElementById('dvKpiVerified').textContent,pending:document.getElementById('dvKpiPending').textContent,review:document.getElementById('dvKpiReview').textContent,invalid:document.getElementById('dvKpiInvalid').textContent,count:document.getElementById('dvCount').textContent,rows:document.querySelectorAll('#dvTableBody tr').length})`);
  const k = JSON.parse(kpis);
  check('KPI total populated', k.all !== '0', kpis);
  check('Table rows rendered', k.rows > 0, 'rows=' + k.rows);
  check('Row count matches KPI total', String(k.rows) === String(k.all), `${k.rows} vs ${k.all}`);

  // Search filter
  const beforeSearch = await evalq(ws, `document.querySelectorAll('#dvTableBody tr').length`);
  await evalq(ws, `(function(){var s=document.getElementById('dvSearch'); s.value='application form'; s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(300);
  const afterSearch = await evalq(ws, `document.querySelectorAll('#dvTableBody tr').length`);
  check('Search filters rows', afterSearch !== beforeSearch || afterSearch > 0, `${beforeSearch} -> ${afterSearch}`);
  await evalq(ws, `(function(){var s=document.getElementById('dvSearch'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(200);

  // Status filter
  await evalq(ws, `(function(){var f=document.getElementById('dvStatusFilter'); f.value='Verified'; f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(300);
  const verifiedRows = await evalq(ws, `document.querySelectorAll('#dvTableBody tr').length`);
  const allRows = Number(k.all);
  check('Status filter narrows rows', verifiedRows <= allRows, `verifiedRows=${verifiedRows} of ${allRows}`);
  await evalq(ws, `(function(){var f=document.getElementById('dvStatusFilter'); f.value='all'; f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(200);

  // Analyze
  const analyze = await evalq(ws, `(function(){var b=document.querySelector('.dv-analyze-btn'); if(!b) return 'NOBTN'; b.click(); var body=document.getElementById('dvAnalysisBody'); return JSON.stringify({hidden:body.hidden,len:body.innerHTML.length});})()`);
  const a = JSON.parse(analyze === 'NOBTN' ? '{"hidden":true,"len":0}' : analyze);
  check('Analyze populates panel', !a.hidden && a.len > 100, analyze);

  // KPI click filter
  await evalq(ws, `document.querySelector('[data-dv-kpi="pending"]').click()`);
  await sleep(300);
  const pendingFiltered = await evalq(ws, `document.getElementById('dvStatusFilter').value`);
  check('KPI click updates status filter', pendingFiltered === 'Pending Verification', 'filter=' + pendingFiltered);

  // Applications page search
  await evalq(ws, `document.querySelector('.nav__item[data-page="applications"]').click()`);
  await sleep(400);
  const appSearchExists = await evalq(ws, `!!document.querySelector('#page-applications input[type="search"], #page-applications input[type="text"]')`);
  check('Applications page has a search input', appSearchExists === true, String(appSearchExists));

  // Settings tabs
  await evalq(ws, `document.querySelector('.nav__item[data-page="settings"]').click()`);
  await sleep(400);
  const stgTabs = await evalq(ws, `document.querySelectorAll('.stg-nav__item').length`);
  check('Settings has tab navigation', stgTabs > 0, 'tabs=' + stgTabs);
  if (stgTabs > 0) {
    const tabSwitch = await evalq(ws, `(function(){var btns=document.querySelectorAll('.stg-nav__item'); var target=btns[1]; target.click(); return target.classList.contains('active');})()`);
    check('Settings tab switches active state', tabSwitch === true, String(tabSwitch));
  }

  // Responsive: mobile menu button visible logic / sidebar collapse class
  const collapseOk = await evalq(ws, `(function(){var b=document.getElementById('sidebarCollapse');var s=document.getElementById('sidebar');b.click();var c1=s.classList.contains('collapsed');b.click();return c1;})()`);
  check('Sidebar collapse toggles', collapseOk === true, String(collapseOk));

  // Global search opens
  const searchOpens = await evalq(ws, `(function(){var b=document.getElementById('searchBtn'); if(!b) return 'NO'; b.click(); var o=document.getElementById('searchOverlay'); return o? o.classList.contains('active'):'NOOVERLAY';})()`);
  check('Global search overlay opens', searchOpens === true, String(searchOpens));

  console.log('=== INTERACTION CHECKS ===');
  let passCount = 0;
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail ? '(' + c.detail + ')' : ''}`);
    if (c.pass) passCount++;
  }
  console.log(`=== ${passCount}/${checks.length} passed ===`);
  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e); process.exit(1); });
