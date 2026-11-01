const list=await (await fetch('http://127.0.0.1:9222/json')).json();
const t=list.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
let id=0;
const send=(method,params={},ms=10000)=>new Promise((resolve,reject)=>{const i=++id;const timer=setTimeout(()=>{ws.removeEventListener('message',h);reject(new Error(method+' timeout'));},ms);const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===i){clearTimeout(timer);ws.removeEventListener('message',h);m.error?reject(new Error(m.error.message)):resolve(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await sleep(400);
console.log(await ev(`JSON.stringify((function(){
 function box(el){var r=el.getBoundingClientRect();var cs=getComputedStyle(el);return {tag:el.tagName,cls:(el.className||'').toString().slice(0,40),left:Math.round(r.left),right:Math.round(r.right),w:Math.round(r.width),sw:el.scrollWidth,cw:el.clientWidth,ox:cs.overflowX,oy:cs.overflowY,ws:cs.whiteSpace,tbl:cs.tableLayout,minw:cs.minWidth};}
 var out={doc:document.documentElement.scrollWidth, wrap:box(document.querySelector('.mt-table-wrap')), table:box(document.querySelector('.mt-table'))};
 out.ths=[...document.querySelectorAll('.mt-table th')].map(box);
 out.rows=[...document.querySelectorAll('.mt-table tbody tr')].slice(0,2).map(function(tr){return {tr:box(tr), tds:[...tr.children].map(box)};});
 return out;
})())`));
console.log('with hidden', await ev(`JSON.stringify((function(){var w=document.querySelector('.mt-table-wrap');var old=w.style.overflowX;w.style.overflowX='hidden';var a=document.documentElement.scrollWidth;w.style.overflowX='clip';var b=document.documentElement.scrollWidth;w.style.overflowX=old;return {hidden:a,clip:b,orig:old,computed:getComputedStyle(w).overflowX};})())`));
ws.close();
