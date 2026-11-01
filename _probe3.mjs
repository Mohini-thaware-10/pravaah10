const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getTargets() { const res = await fetch(DEBUG + '/json'); const list = await res.json(); return list.find(t => t.type === 'page'); }
function connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.onopen = () => resolve(ws); ws.onerror = () => reject(new Error('ws error')); }); }
let idc = 0;
function send(ws, method, params = {}) { const id = ++idc; return new Promise((resolve, reject) => { const handler = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === id) { ws.removeEventListener('message', handler); if (msg.error) reject(new Error(method + ': ' + msg.error.message)); else resolve(msg.result); } }; ws.addEventListener('message', handler); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(ws, expr) { const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; }
async function main() {
  const target = await getTargets();
  const ws = await connect(target.webSocketDebuggerUrl);
  await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(3500);
  await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="impact-map"]'); if(el) el.click(); return 1;})()`);
  await sleep(600);
  const html = await ev(ws, `(function(){var p=document.getElementById('page-impact-map'); return p?p.innerHTML.slice(0,1600):'none';})()`);
  console.log(html);
  const classes = await ev(ws, `JSON.stringify([...new Set([...document.querySelectorAll('#page-impact-map *')].map(e=>e.className).filter(c=>typeof c==='string'))].slice(0,40))`);
  console.log('--- classes ---');
  console.log(classes);
  ws.close();
}
main().then(() => process.exit(0)).catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
