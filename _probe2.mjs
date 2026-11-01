const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getTargets() {
  const res = await fetch(DEBUG + '/json');
  const list = await res.json();
  return list.find(t => t.type === 'page');
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(3500);

  console.log('im-panel count:', await ev(ws, `document.querySelectorAll('.im-panel').length`));
  console.log('im-main count:', await ev(ws, `document.querySelectorAll('.im-main').length`));
  console.log('impact page exists:', await ev(ws, `!!document.getElementById('page-impact-map')`));

  for (const p of ['pre-submission-simulator','trace-graph','impact-map','settings','reports-analytics']) {
    await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(el) el.click(); return 1;})()`);
    await sleep(300);
    const main = { 'pre-submission-simulator':'.sim-main','trace-graph':'.tg-main','impact-map':'.im-main','settings':'.stg-layout','reports-analytics':'.rpt-analytics-grid' }[p];
    const out = await ev(ws, `(function(){var el=document.querySelector('${main}'); if(!el) return 'missing'; var cs=getComputedStyle(el); return JSON.stringify({display:cs.display, cols:cs.gridTemplateColumns, w:el.clientWidth});})()`);
    console.log(p.padEnd(26), out);
  }

  const titles = await ev(ws, `JSON.stringify(['reports-analytics','approval-stages','help'].map(p=>{var pg=document.getElementById('page-'+p); var h=pg&&pg.querySelector('h1'); return {p, size:h?getComputedStyle(h).fontSize:null};}))`);
  console.log('h1 sizes:', titles);

  await send(ws, 'Emulation.clearDeviceMetricsOverride');
  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
