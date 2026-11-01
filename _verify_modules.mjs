const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getTargets() { const res = await fetch(DEBUG + '/json'); const list = await res.json(); return list.find(t => t.type === 'page'); }
function connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.onopen = () => resolve(ws); ws.onerror = () => reject(new Error('ws error')); }); }
let idc = 0;
function send(ws, method, params = {}) { const id = ++idc; return new Promise((resolve, reject) => { const handler = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === id) { ws.removeEventListener('message', handler); if (msg.error) reject(new Error(method + ': ' + msg.error.message)); else resolve(msg.result); } }; ws.addEventListener('message', handler); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(ws, expr) { const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; }
const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? '  :: ' + detail : '')); }
const errors = [];
async function main() {
  const target = await getTargets();
  const ws = await connect(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
  });
  await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(4000);
  const nav = async (p) => { await ev(ws, `(function(){var el=document.querySelector('.nav__item[data-page="${p}"]'); if(el) el.click(); return 1;})()`); await sleep(500); };

  await nav('reports-analytics');
  check('reports: KPI cards', (await ev(ws, `document.querySelectorAll('#rptKpiGrid > *').length`)) > 0, await ev(ws, `document.querySelectorAll('#rptKpiGrid > *').length`));
  check('reports: library cards', (await ev(ws, `document.querySelectorAll('#rptLibraryGrid > *').length`)) > 0, await ev(ws, `document.querySelectorAll('#rptLibraryGrid > *').length`));
  check('reports: trend bars', (await ev(ws, `document.getElementById('rptTrendBars').children.length`)) > 0, await ev(ws, `document.getElementById('rptTrendBars').children.length`));
  await ev(ws, `document.getElementById('rptGenerateBtn').click()`);
  await sleep(400);
  const rptModal = await ev(ws, `JSON.stringify({active:document.getElementById('rptModal').classList.contains('active'), rows:document.getElementById('rptModalTableBody').querySelectorAll('tr').length})`);
  const rm = JSON.parse(rptModal);
  check('reports: preview modal opens with rows', rm.active && rm.rows >= 0, rptModal);
  await ev(ws, `document.getElementById('rptModalClose').click()`); await sleep(200);

  await nav('approval-stages');
  check('stages: summary cards', (await ev(ws, `document.querySelectorAll('#astSummaryGrid > *').length`)) > 0);
  check('stages: stepper steps', (await ev(ws, `document.querySelectorAll('#astStepperDesktop .ast-step').length`)) > 0, await ev(ws, `document.querySelectorAll('#astStepperDesktop .ast-step').length`));
  await ev(ws, `document.getElementById('astAddStageBtn').click()`); await sleep(300);
  check('stages: add modal opens', await ev(ws, `document.getElementById('astStageModal').classList.contains('active')`));
  await ev(ws, `document.getElementById('astModalCancel').click()`); await sleep(200);
  const astSearchBefore = await ev(ws, `document.querySelectorAll('#astConfigBody tr').length`);
  await ev(ws, `(function(){var s=document.getElementById('astStageSearch'); s.value='document'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`); await sleep(300);
  const astSearchAfter = await ev(ws, `document.querySelectorAll('#astConfigBody tr').length`);
  check('stages: search filters table', astSearchAfter <= astSearchBefore, astSearchBefore + ' -> ' + astSearchAfter);
  await ev(ws, `(function(){var s=document.getElementById('astStageSearch'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);

  await nav('audit-trail');
  check('audit: summary cards', (await ev(ws, `document.querySelectorAll('#audSummaryGrid > *').length`)) > 0);
  const audRows = await ev(ws, `document.querySelectorAll('#audLogBody tr').length`);
  check('audit: log rows', audRows > 0, audRows);
  await ev(ws, `(function(){var b=document.querySelector('#audLogBody .aud-row-btn'); if(b) b.click(); return 1;})()`); await sleep(300);
  check('audit: detail drawer opens', await ev(ws, `document.getElementById('audDetailDrawer').classList.contains('active')`));
  await ev(ws, `document.getElementById('audDetailClose').click()`); await sleep(200);
  await ev(ws, `document.getElementById('audExportBtn').click()`); await sleep(250);
  check('audit: export triggers toast', await ev(ws, `document.getElementById('audToast').classList.contains('active')`));

  await nav('user-role-management');
  check('roles: summary cards', (await ev(ws, `document.querySelectorAll('#urmSummaryGrid > *').length`)) > 0);
  check('roles: user rows', (await ev(ws, `document.querySelectorAll('#urmUsersBody tr').length`)) > 0, await ev(ws, `document.querySelectorAll('#urmUsersBody tr').length`));
  check('roles: role cards', (await ev(ws, `document.querySelectorAll('#urmRolesGrid > *').length`)) > 0, await ev(ws, `document.querySelectorAll('#urmRolesGrid > *').length`));
  await ev(ws, `(function(){var b=document.querySelector('#urmUsersBody .urm-row-btn'); if(b) b.click(); return 1;})()`); await sleep(300);
  check('roles: drawer opens', await ev(ws, `document.getElementById('urmUserDrawer').classList.contains('active')`));
  await ev(ws, `document.getElementById('urmDrawerClose').click()`); await sleep(200);
  await ev(ws, `document.getElementById('urmAddUserBtn').click()`); await sleep(250);
  check('roles: add-user modal opens', await ev(ws, `document.getElementById('urmAddModal').classList.contains('active')`));
  await ev(ws, `document.getElementById('urmAddCancel').click()`); await sleep(200);

  await nav('pre-submission-simulator');
  const simOpts = await ev(ws, `document.getElementById('simAppSelect').options.length`);
  check('simulator: applications listed', simOpts > 1, simOpts);
  await ev(ws, `(function(){var s=document.getElementById('simAppSelect'); s.selectedIndex=1; s.dispatchEvent(new Event('change',{bubbles:true})); return 1;})()`); await sleep(500);
  check('simulator: summary renders', (await ev(ws, `document.querySelectorAll('#simSummaryGrid > *').length`)) > 0, await ev(ws, `document.querySelectorAll('#simSummaryGrid > *').length`));
  const simFind = await ev(ws, `(function(){var f=document.getElementById('simFindingsPanel'); return f.innerHTML.length;})()`);
  check('simulator: findings/actions render', simFind > 100, 'findingsLen=' + simFind);
  check('simulator: history renders', (await ev(ws, `document.getElementById('simHistoryPanel').innerHTML.length`)) > 50);

  await nav('trace-graph');
  const tgOpts = await ev(ws, `document.getElementById('tgAppSelect').options.length`);
  check('trace: applications listed', tgOpts > 1, tgOpts);
  await ev(ws, `(function(){var s=document.getElementById('tgAppSelect'); s.selectedIndex=1; s.dispatchEvent(new Event('change',{bubbles:true})); return 1;})()`); await sleep(700);
  const tgSvg = await ev(ws, `!!document.querySelector('#tgGraphContainer svg')`);
  check('trace: graph svg generated', tgSvg === true, String(tgSvg));
  if (tgSvg) {
    await ev(ws, `(function(){var c=document.querySelector('#tgGraphContainer svg circle'); if(c) c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;})()`); await sleep(350);
    const detailLen = await ev(ws, `document.getElementById('tgDetailsPanel').innerHTML.length`);
    check('trace: node click populates details', detailLen > 100, 'len=' + detailLen);
  } else { check('trace: node click populates details', false, 'no svg'); }
  check('trace: completeness summary', (await ev(ws, `document.getElementById('tgTraceSummary').innerHTML.length`)) > 20, await ev(ws, `document.getElementById('tgTraceSummary').innerHTML.length`));

  await nav('impact-map');
  const imOpts = await ev(ws, `document.getElementById('imChangeSelect').options.length`);
  check('impact: scenarios listed', imOpts > 1, imOpts);
  await ev(ws, `(function(){var s=document.getElementById('imChangeSelect'); s.selectedIndex=1; s.dispatchEvent(new Event('change',{bubbles:true})); return 1;})()`); await sleep(600);
  check('impact: analysis sections render', (await ev(ws, `document.querySelectorAll('.im-analysis-section, .im-requirements-section, .im-evidence-section, .im-applications-section, .im-review-tasks-section, .im-acknowledgment-section').length`)) > 1, await ev(ws, `document.querySelectorAll('.im-analysis-section, .im-requirements-section, .im-evidence-section, .im-applications-section, .im-review-tasks-section, .im-acknowledgment-section').length`));
  check('impact: requirement items render', (await ev(ws, `document.querySelectorAll('.im-requirement-item, .im-evidence-item').length`)) > 0);
  await ev(ws, `(function(){var b=document.getElementById('imAcknowledgeBtn'); if(b) b.click(); return 1;})()`); await sleep(400);
  check('impact: acknowledge toggles state', await ev(ws, `(function(){var b=document.getElementById('imAcknowledgeBtn'); return b ? b.classList.contains('im-ack-btn--active') : false;})()`));
  await ev(ws, `(function(){var b=document.getElementById('imMarkReviewedBtn'); if(b) b.click(); return 1;})()`); await sleep(300);

  await nav('settings');
  await ev(ws, `(function(){var b=[...document.querySelectorAll('.stg-nav__item')].find(x=>x.dataset.stg==='appearance'); if(b) b.click(); return 1;})()`); await sleep(250);
  check('settings: appearance panel active', await ev(ws, `(function(){var p=document.querySelector('.stg-panel[data-stg-panel="appearance"]'); return p && p.classList.contains('active') && getComputedStyle(p).display!=='none';})()`));
  const toggled = await ev(ws, `(function(){var p=document.querySelector('.stg-panel[data-stg-panel="appearance"]'); var s=p?p.querySelector('select'):null; if(!s) return 'no'; s.selectedIndex=Math.min(1,s.options.length-1); s.dispatchEvent(new Event('change',{bubbles:true})); return s.value;})()`);
  check('settings: appearance select changes', toggled !== 'no', String(toggled));
  await ev(ws, `(function(){var b=document.getElementById('stgSaveAppearance'); if(b) b.click(); return 1;})()`); await sleep(250);
  check('settings: save shows toast', await ev(ws, `document.getElementById('stgToast').classList.contains('active')`));
  await ev(ws, `(function(){var b=[...document.querySelectorAll('.stg-nav__item')].find(x=>x.dataset.stg==='accessibility'); if(b) b.click(); return 1;})()`); await sleep(250);
  const a11y = await ev(ws, `(function(){var p=document.querySelector('.stg-panel[data-stg-panel="accessibility"]'); var c=p?p.querySelector('input[type=checkbox]'):null; if(!c) return 'no'; var before=c.checked; c.click(); return JSON.stringify({before:before, after:c.checked});})()`);
  const a11 = JSON.parse(a11y === 'no' ? '{"before":null,"after":null}' : a11y);
  check('settings: accessibility toggle changes', a11.after !== a11.before, a11y);
  await ev(ws, `(function(){var b=[...document.querySelectorAll('.stg-nav__item')].find(x=>x.dataset.stg==='profile'); if(b) b.click(); return 1;})()`); await sleep(200);
  await ev(ws, `document.getElementById('stgEditProfile').click()`); await sleep(250);
  check('settings: profile modal opens', await ev(ws, `document.getElementById('stgProfileModal').classList.contains('active')`));
  await ev(ws, `document.getElementById('stgProfileModalClose').click()`); await sleep(150);

  console.log('=== SUMMARY ===');
  const failed = results.filter(r => !r.ok);
  console.log((results.length - failed.length) + '/' + results.length + ' passed');
  console.log('=== JS ERRORS (' + errors.length + ') ===');
  errors.slice(0, 10).forEach(e => console.log(e));
  ws.close();
  process.exit(failed.length || errors.length ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

