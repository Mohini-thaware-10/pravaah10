const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';

const PAGES = ['reports-analytics','approval-stages','audit-trail','help','user-role-management','pre-submission-simulator','trace-graph','impact-map','settings'];
const PANEL = {
  'reports-analytics': '.rpt-panel',
  'approval-stages': '.ast-panel',
  'audit-trail': '.aud-panel',
  'help': '.hlp-panel',
  'user-role-management': '.urm-panel',
  'pre-submission-simulator': '.sim-panel',
  'trace-graph': '.tg-panel',
  'impact-map': '.im-panel',
  'settings': '.stg-panel.active'
};

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
    ws.onerror = () => reject(new Error('ws error'));
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
async function ev(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result.value;
}

async function main() {
  const target = await getTargets();
  const ws = await connect(target.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(3500);

  const sheet = await ev(ws, `JSON.stringify([...document.styleSheets].map(s=>s.href||'inline').filter(h=>h.includes('modules.css')))`);
  console.log('modules.css sheets:', sheet);

  console.log('=== DESKTOP ===');
  for (const p of PAGES) {
    await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(el) el.click(); return 1;})()`);
    await sleep(350);
    const sel = PANEL[p];
    const out = await ev(ws, `(function(){
      var el=document.querySelector('${sel}');
      if(!el) return JSON.stringify({missing:true});
      var cs=getComputedStyle(el);
      var btn=el.querySelector('button');
      var bcs=btn?getComputedStyle(btn):null;
      var title=el.querySelector('h1,h2,h3');
      var tcs=title?getComputedStyle(title):null;
      return JSON.stringify({
        display:cs.display, padding:cs.padding, border:cs.borderTopWidth, bg:cs.backgroundColor,
        btnBg:bcs?bcs.backgroundColor:null, btnRadius:bcs?bcs.borderRadius:null,
        titleSize:tcs?tcs.fontSize:null,
        overflow:(document.documentElement.scrollWidth-document.documentElement.clientWidth)
      });
    })()`);
    console.log(p.padEnd(26), out);
  }

  console.log('=== GRID LAYOUTS ===');
  for (const p of ['pre-submission-simulator','trace-graph','impact-map','settings']) {
    await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(el) el.click(); return 1;})()`);
    await sleep(300);
    const main = p==='settings' ? '.stg-layout' : (p==='pre-submission-simulator' ? '.sim-main' : (p==='trace-graph' ? '.tg-main' : '.im-main'));
    const out = await ev(ws, `(function(){var el=document.querySelector('${main}'); if(!el) return 'missing'; var cs=getComputedStyle(el); return JSON.stringify({display:cs.display, cols:cs.gridTemplateColumns});})()`);
    console.log(p.padEnd(26), out);
  }

  console.log('=== SETTINGS PANELS ===');
  const stg = await ev(ws, `JSON.stringify([...document.querySelectorAll('.stg-panel')].map(p=>({key:p.dataset.stgPanel, display:getComputedStyle(p).display})))`);
  console.log(stg);

  console.log('=== MOBILE 390px OVERFLOW ===');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  for (const p of PAGES) {
    await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(!el){var s=document.getElementById('sidebar'); if(s){s.classList.remove('open');} } return 1;})()`);
    await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(el) el.click(); var lb=document.getElementById('sidebarOverlay'); if(lb) lb.click(); return 1;})()`);
    await sleep(250);
    const out = await ev(ws, `(function(){var pg=document.getElementById('page-${p}'); if(!pg) return 'no-page'; var w=pg.scrollWidth, c=pg.clientWidth; return JSON.stringify({sw:w, cw:c, over:w-c});})()`);
    console.log(p.padEnd(26), out);
  }
  await send(ws, 'Emulation.clearDeviceMetricsOverride');

  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
