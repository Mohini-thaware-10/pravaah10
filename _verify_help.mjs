const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getTargets() { const res = await fetch(DEBUG + '/json'); const list = await res.json(); return list.find(t => t.type === 'page'); }
function connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.onopen = () => resolve(ws); ws.onerror = () => reject(new Error('ws error')); }); }
let idc = 0;
function send(ws, method, params = {}) { const id = ++idc; return new Promise((resolve, reject) => { const handler = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === id) { ws.removeEventListener('message', handler); if (msg.error) reject(new Error(method + ': ' + msg.error.message)); else resolve(msg.result); } }; ws.addEventListener('message', handler); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(ws, expr) { const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; }
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  :: ' + detail : '')); }
async function main() {
  const target = await getTargets();
  const ws = await connect(target.webSocketDebuggerUrl);
  await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(4000);
  await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="help"]'); if(el) el.click(); return 1;})()`);
  await sleep(400);

  const total = await ev(ws, `document.querySelectorAll('#hlpArticles .hlp-card').length`);
  check('articles rendered', total > 10, 'count=' + total);
  const cats = await ev(ws, `document.querySelectorAll('#hlpCats .hlp-cat').length`);
  check('categories rendered', cats >= 5, 'count=' + cats);
  const faq = await ev(ws, `document.querySelectorAll('#hlpFaq .hlp-faq__item').length`);
  check('faq rendered', faq >= 5, 'count=' + faq);

  await ev(ws, `(function(){var s=document.getElementById('hlpSearch'); s.value='trace'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  await sleep(250);
  const searched = await ev(ws, `document.querySelectorAll('#hlpArticles .hlp-card').length`);
  const countText = await ev(ws, `document.getElementById('hlpResultCount').textContent`);
  check('search filters articles', searched > 0 && searched < total, 'after=' + searched + ' text=' + countText);

  await ev(ws, `(function(){var c=document.querySelector('#hlpArticles .hlp-card'); if(c) c.click(); return 1;})()`);
  await sleep(250);
  const detailOpen = await ev(ws, `(function(){var d=document.getElementById('hlpDetail'); var l=document.getElementById('hlpArticles'); return JSON.stringify({hidden:d.hidden, listHidden:l.hidden, title:(d.querySelector('.hlp-article__title')||{}).textContent||''});})()`);
  const d1 = JSON.parse(detailOpen);
  check('article detail opens', d1.hidden === false && d1.listHidden === true && d1.title.length > 0, detailOpen);

  await ev(ws, `document.getElementById('hlpBack').click()`);
  await sleep(200);
  const backState = await ev(ws, `JSON.stringify({hidden:document.getElementById('hlpDetail').hidden, listHidden:document.getElementById('hlpArticles').hidden})`);
  const b1 = JSON.parse(backState);
  check('back restores list', b1.hidden === true && b1.listHidden === false, backState);

  await ev(ws, `(function(){var s=document.getElementById('hlpSearch'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  await sleep(200);
  await ev(ws, `(function(){var b=[...document.querySelectorAll('#hlpCats .hlp-cat')].find(x=>x.dataset.cat==='Troubleshooting'); if(b) b.click(); return 1;})()`);
  await sleep(250);
  const catCount = await ev(ws, `document.querySelectorAll('#hlpArticles .hlp-card').length`);
  const activeCat = await ev(ws, `(document.querySelector('#hlpCats .hlp-cat.active')||{}).dataset ? document.querySelector('#hlpCats .hlp-cat.active').dataset.cat : ''`);
  check('category filter works', catCount >= 1 && catCount < total && activeCat === 'Troubleshooting', 'count=' + catCount + ' active=' + activeCat);

  await ev(ws, `(function(){var b=document.querySelector('#hlpFaq .hlp-faq__q'); b.click(); return 1;})()`);
  await sleep(200);
  const faq1 = await ev(ws, `(function(){var it=document.querySelector('#hlpFaq .hlp-faq__item'); var a=it.querySelector('.hlp-faq__a'); return JSON.stringify({active:it.classList.contains('active'), hidden:a.hidden, expanded:it.querySelector('.hlp-faq__q').getAttribute('aria-expanded')});})()`);
  const f1 = JSON.parse(faq1);
  check('faq opens', f1.active === true && f1.hidden === false && f1.expanded === 'true', faq1);

  await ev(ws, `(function(){var q=[...document.querySelectorAll('#hlpFaq .hlp-faq__q')]; q[1].click(); return 1;})()`);
  await sleep(200);
  const faq2 = await ev(ws, `(function(){var items=[...document.querySelectorAll('#hlpFaq .hlp-faq__item')]; return JSON.stringify({firstActive:items[0].classList.contains('active'), secondActive:items[1].classList.contains('active')});})()`);
  const f2 = JSON.parse(faq2);
  check('faq single-open accordion', f2.firstActive === false && f2.secondActive === true, faq2);

  const styled = await ev(ws, `(function(){var el=document.querySelector('.hlp-card'); if(!el) return 'no'; var cs=getComputedStyle(el); return JSON.stringify({display:cs.display, border:cs.borderTopWidth, radius:cs.borderRadius});})()`);
  const s1 = JSON.parse(styled);
  check('help cards styled', s1.display === 'flex' && s1.border !== '0px', styled);

  console.log('=== SUMMARY ===');
  const failed = results.filter(r => !r.ok);
  console.log((results.length - failed.length) + '/' + results.length + ' passed');
  ws.close();
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
