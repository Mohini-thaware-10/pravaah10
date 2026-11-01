const DEBUG = 'http://127.0.0.1:9222';
const BASE = process.env.BASE || 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getTargets() { const res = await fetch(DEBUG + '/json'); const list = await res.json(); return list.find(t => t.type === 'page'); }
function connect(url) { return new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.onopen = () => resolve(ws); ws.onerror = () => reject(new Error('ws error')); }); }
let idc = 0;
function send(ws, method, params = {}) { const id = ++idc; return new Promise((resolve, reject) => { const handler = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === id) { ws.removeEventListener('message', handler); if (msg.error) reject(new Error(method + ': ' + msg.error.message)); else resolve(msg.result); } }; ws.addEventListener('message', handler); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(ws, expr) { const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return r.result.value; }
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url: BASE + '/app.html' });
  await sleep(4500);

  const expectedGroups = ['Overview', 'Applications', 'Documents & Compliance', 'Intelligence', 'Tasks & Alerts', 'Analytics', 'Administration', 'Support & Preferences'];
  const groups = JSON.parse(await ev(ws, `JSON.stringify([...document.querySelectorAll('#sidebarNav .sidebar__group-label')].map(e=>e.textContent.trim()))`));
  check('sidebar: 8 groups rendered', groups.length === 8, groups.length);
  check('sidebar: group labels match spec', JSON.stringify(groups) === JSON.stringify(expectedGroups), groups.join(' | '));

  const navInfo = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var items=[...document.querySelectorAll('#sidebarNav .nav__item[data-page]')];
    var pages=[...document.querySelectorAll('.page')].map(p=>p.id.replace('page-',''));
    var ids=items.map(i=>i.dataset.page);
    return {count:items.length, unique:new Set(ids).size, missing:ids.filter(id=>pages.indexOf(id)===-1), ids:ids};
  })())`));
  check('sidebar: all 19 routes present', navInfo.count === 19, navInfo.count);
  check('sidebar: no duplicate routes', navInfo.unique === navInfo.count, navInfo.unique);
  check('sidebar: every route has a page', navInfo.missing.length === 0, navInfo.missing.join(','));

  const navAll = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var items=[...document.querySelectorAll('#sidebarNav .nav__item[data-page]')];
    var fails=[];
    items.forEach(function(it){
      it.click();
      var page=document.getElementById('page-'+it.dataset.page);
      if(!page || !page.classList.contains('active')) fails.push(it.dataset.page);
    });
    var ov=document.querySelector('#sidebarNav .nav__item[data-page="overview"]');
    if(ov) ov.click();
    return fails;
  })())`));
  check('sidebar: every submenu item navigates', navAll.length === 0, navAll.join(','));

  const initial = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var g=document.querySelector('.sidebar__group[data-group="overview"]');
    return {open:g.classList.contains('open'), expanded:g.querySelector('.sidebar__group-toggle').getAttribute('aria-expanded'),
      active:document.querySelector('#sidebarNav .nav__item[data-page="overview"]').classList.contains('active'),
      current:document.querySelector('#sidebarNav .nav__item[data-page="overview"]').getAttribute('aria-current')};
  })())`));
  check('sidebar: active group auto-expanded', initial.open && initial.expanded === 'true', JSON.stringify(initial));
  check('sidebar: active item highlighted + aria-current', initial.active && initial.current === 'page', JSON.stringify(initial));

  await ev(ws, `(function(){['applications','documents','intelligence','analytics'].forEach(function(k){var g=document.querySelector('.sidebar__group[data-group="'+k+'"]'); if(g && !g.classList.contains('open')) g.querySelector('.sidebar__group-toggle').click();}); return 1;})()`);
  await sleep(400);
  const openCount = await ev(ws, `document.querySelectorAll('#sidebarNav .sidebar__group.open').length`);
  check('sidebar: max two groups stay open', openCount <= 2, openCount);

  await ev(ws, `document.querySelector('#sidebarNav .nav__item[data-page="pre-submission-simulator"]').click()`);
  await sleep(500);
  const auto = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var g=document.querySelector('.sidebar__group[data-group="documents"]');
    return {open:g.classList.contains('open'), active:document.querySelector('#sidebarNav .nav__item[data-page="pre-submission-simulator"]').classList.contains('active'), page:document.getElementById('page-pre-submission-simulator').classList.contains('active'), openCount:document.querySelectorAll('#sidebarNav .sidebar__group.open').length};
  })())`));
  check('sidebar: navigation auto-expands its group', auto.open && auto.active && auto.page, JSON.stringify(auto));
  check('sidebar: auto-expand still respects max two', auto.openCount <= 2, auto.openCount);

  const collapseBefore = await ev(ws, `sidebar = document.getElementById('sidebar'); Math.round(sidebar.getBoundingClientRect().width)`);
  await ev(ws, `document.getElementById('sidebarCollapse').click()`);
  await sleep(450);
  const collapsed = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var s=document.getElementById('sidebar');
    var label=document.querySelector('#sidebarNav .sidebar__group-label');
    var toggle=document.querySelector('#sidebarNav .sidebar__group-toggle');
    return {collapsed:s.classList.contains('collapsed'), width:Math.round(s.getBoundingClientRect().width), labelDisplay:getComputedStyle(label).display, tooltip:getComputedStyle(toggle,'::after').content, aria:s.getAttribute('data-collapsed'), btnAria:document.getElementById('sidebarCollapse').getAttribute('aria-expanded')};
  })())`));
  check('sidebar: collapse button collapses to icon rail', collapsed.collapsed && collapsed.width >= 68 && collapsed.width <= 76, JSON.stringify(collapsed));
  check('sidebar: labels hidden + accessible tooltip', collapsed.labelDisplay === 'none' && /Overview|Applications|Documents/.test(collapsed.tooltip || ''), collapsed.tooltip);
  check('sidebar: collapse state exposed to assistive tech', collapsed.aria === 'true' && collapsed.btnAria === 'false', JSON.stringify(collapsed));

  await ev(ws, `document.querySelector('.sidebar__group[data-group="analytics"] .sidebar__group-toggle').click()`);
  await sleep(450);
  const reopened = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var s=document.getElementById('sidebar');
    var g=document.querySelector('.sidebar__group[data-group="analytics"]');
    return {collapsed:s.classList.contains('collapsed'), open:g.classList.contains('open')};
  })())`));
  check('sidebar: clicking a group in rail expands sidebar', !reopened.collapsed && reopened.open, JSON.stringify(reopened));

  await ev(ws, `document.getElementById('sidebarCollapse').click()`);
  await sleep(300);

  const scroll = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var n=document.querySelector('.sidebar__nav');
    return {nav:getComputedStyle(n).overflowY, sidebar:getComputedStyle(document.getElementById('sidebar')).overflow};
  })())`));
  check('sidebar: nav scrolls independently', scroll.nav === 'auto' && scroll.sidebar === 'hidden', JSON.stringify(scroll));

  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await ev(ws, `document.getElementById('mobileMenuBtn').click()`);
  await sleep(500);
  const mobileOpen = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var s=document.getElementById('sidebar');
    return {open:s.classList.contains('mobile-open'), backdrop:document.getElementById('sidebarBackdrop').classList.contains('active'), body:document.body.classList.contains('sidebar-open'), transform:getComputedStyle(s).transform};
  })())`));
  check('mobile: drawer opens with backdrop', mobileOpen.open && mobileOpen.backdrop && mobileOpen.body, JSON.stringify(mobileOpen));

  await ev(ws, `document.querySelector('#sidebarNav .nav__item[data-page="notifications"]').click()`);
  await sleep(600);
  const mobileClosed = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var s=document.getElementById('sidebar');
    return {open:s.classList.contains('mobile-open'), backdrop:document.getElementById('sidebarBackdrop').classList.contains('active'), page:document.getElementById('page-notifications').classList.contains('active'), overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1};
  })())`));
  check('mobile: navigation closes drawer and backdrop', !mobileClosed.open && !mobileClosed.backdrop && mobileClosed.page, JSON.stringify(mobileClosed));
  check('mobile: no horizontal overflow', mobileClosed.overflow, JSON.stringify(mobileClosed));

  const nf = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var d=document.getElementById('nfList');
    return {items:d.querySelectorAll('.nf-item').length, unread:d.querySelectorAll('.nf-item--unread').length, kpi:document.getElementById('nfKpiUnread').textContent};
  })())`));
  check('notifications: renders demo alerts', nf.items === 6 && nf.unread === 3, JSON.stringify(nf));
  await ev(ws, `document.querySelector('#nfFilters .nf-filter[data-filter="unread"]').click()`);
  await sleep(250);
  const nfUnread = await ev(ws, `document.querySelectorAll('#nfList .nf-item').length`);
  check('notifications: unread filter works', nfUnread === 3, nfUnread);
  await ev(ws, `document.getElementById('nfMarkAll').click()`);
  await sleep(250);
  const nfRead = JSON.parse(await ev(ws, `JSON.stringify({unread:document.querySelectorAll('#nfList .nf-item--unread').length, btnDisabled:document.getElementById('nfMarkAll').disabled})`));
  check('notifications: mark all read works', nfRead.unread === 0 && nfRead.btnDisabled, JSON.stringify(nfRead));
  await ev(ws, `document.querySelector('#nfFilters .nf-filter[data-filter="all"]').click()`);
  await sleep(200);
  await ev(ws, `document.querySelector('#nfList .nf-view-btn').click()`);
  await sleep(500);
  const nfView = await ev(ws, `document.getElementById('page-document-verification').classList.contains('active')`);
  check('notifications: view action navigates to context', nfView, nfView);

  await ev(ws, `document.querySelector('#sidebarNav .nav__item[data-page="my-tasks"]').click()`);
  await sleep(500);
  const mt = JSON.parse(await ev(ws, `JSON.stringify((function(){
    return {rows:document.querySelectorAll('#mtBody tr').length, open:Number(document.getElementById('mtKpiOpen').textContent), overlay:document.documentElement.scrollWidth<=document.documentElement.clientWidth+1};
  })())`));
  check('my-tasks: demo tasks render from applications', mt.rows > 0 && mt.open > 0, JSON.stringify(mt));
  check('my-tasks: no horizontal overflow', mt.overlay, JSON.stringify(mt));
  await ev(ws, `document.querySelector('#mtBody .mt-done-btn').click()`);
  await sleep(300);
  const mtDone = JSON.parse(await ev(ws, `JSON.stringify({done:Number(document.getElementById('mtKpiDone').textContent), completed:document.querySelectorAll('#mtBody .mt-status--done').length})`));
  check('my-tasks: mark done updates summary', mtDone.done === 1 && mtDone.completed >= 1, JSON.stringify(mtDone));
  await ev(ws, `(function(){var s=document.getElementById('mtSearch'); s.value='zzzzzz'; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  await sleep(300);
  const mtEmpty = JSON.parse(await ev(ws, `JSON.stringify({rows:document.querySelectorAll('#mtBody tr').length, empty:!document.getElementById('mtEmpty').hidden})`));
  check('my-tasks: search filters to empty state', mtEmpty.rows === 0 && mtEmpty.empty, JSON.stringify(mtEmpty));
  await ev(ws, `(function(){var s=document.getElementById('mtSearch'); s.value=''; s.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);

  await ev(ws, `document.querySelector('#mtBody .mt-open-btn').click()`);
  await sleep(500);
  const mtOpen = await ev(ws, `!!document.querySelector('.page.active') && document.querySelector('.page.active').id !== 'page-my-tasks'`);
  check('my-tasks: open action navigates', mtOpen, mtOpen);

  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);

  const compact = JSON.parse(await ev(ws, `JSON.stringify((function(){
    var s=document.getElementById('sidebar');
    var t=document.querySelector('#sidebarNav .sidebar__group-toggle');
    var n=document.querySelector('#sidebarNav .nav__item');
    return {sidebar:getComputedStyle(s).width, toggleH:Math.round(t.getBoundingClientRect().height), itemH:Math.round(n.getBoundingClientRect().height), fontSize:getComputedStyle(t).fontSize, radius:getComputedStyle(t).borderRadius, newView:!!document.getElementById('newWorkspaceBtn')};
  })())`));
  check('sidebar: compact desktop dimensions', parseInt(compact.sidebar, 10) >= 250 && parseInt(compact.sidebar, 10) <= 270 && compact.toggleH >= 38 && compact.toggleH <= 42 && compact.itemH >= 32 && compact.itemH <= 36 && /13|14/.test(compact.fontSize), JSON.stringify(compact));
  check('sidebar: compact new-view action retained', compact.newView, compact.newView);

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.ok).length;
  console.log(passed + '/' + results.length + ' passed');
  console.log('=== JS ERRORS (' + errors.length + ') ===');
  errors.forEach(e => console.log(e));
  await send(ws, 'Browser.close').catch(() => {});
  process.exit(passed === results.length && errors.length === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });

