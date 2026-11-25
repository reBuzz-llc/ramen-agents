// Finger mode for the Samples page's Phone preview: the mouse acts like a finger, so the page can be dragged up, down and
// sideways. Added only to the html the team's preview iframe gets (?finger=1): the stored page, Open site and anything
// published never carry it. pageCsp hashes every inline script, so it runs without loosening the page's CSP. A template page
// allows no script at all and is left as it is.

const tip = (fill: string, r: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='${r}' fill='${fill}' stroke='rgba(255,255,255,.9)' stroke-width='1.5'/></svg>`)}") 16 16`;

const CSS = [
  `html[data-peek-finger],html[data-peek-finger] *{scrollbar-width:none}`,
  `html[data-peek-finger]::-webkit-scrollbar,html[data-peek-finger] *::-webkit-scrollbar{display:none}`,
  `html[data-peek-finger=up],html[data-peek-finger=up] *{cursor:${tip("rgba(20,20,20,.3)", 13)},grab!important}`,
  `html[data-peek-finger=down],html[data-peek-finger=down] *{cursor:${tip("rgba(20,20,20,.5)", 10)},grabbing!important}`,
  `html[data-peek-finger=up],html[data-peek-finger=up] *,html[data-peek-finger=down],html[data-peek-finger=down] *{-webkit-user-select:none;user-select:none;-webkit-user-drag:none}`,
].join("");

// Mouse only: a real touch screen already scrolls. Option held selects text as usual.
const JS = `(function(){
if(!matchMedia('(any-pointer:fine)').matches)return;
var root=document.documentElement,body=document.body,doc=document.scrollingElement||root;
var press=null,drag=null,swallow=false,job=null;
root.setAttribute('data-peek-finger','up');
function mode(m){root.setAttribute('data-peek-finger',m)}
function pos(e,x){return x?e.scrollLeft:e.scrollTop}
function max(e,x){return x?e.scrollWidth-e.clientWidth:e.scrollHeight-e.clientHeight}
function put(e,x,v){var o={behavior:'instant'};o[x?'left':'top']=v;e.scrollTo(o)}
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function scrolls(e,x){var c=getComputedStyle(e),o=x?c.overflowX:c.overflowY;return(o==='auto'||o==='scroll')&&max(e,x)>1}
function room(e,x,d){var p=pos(e,x);return d>0?p<max(e,x)-1:p>1}
function find(t,x,d){
for(var e=t;e&&e.nodeType===1&&e!==body&&e!==root;e=e.parentElement){if(scrolls(e,x)&&room(e,x,d))return e}
if(x)return null;
if(max(doc,false)>1)return doc;
return scrolls(body,false)?body:doc;
}
function freeze(e){
var c=getComputedStyle(e).scrollSnapType;
if(!c||c==='none')return null;
var old={v:e.style.getPropertyValue('scroll-snap-type'),p:e.style.getPropertyPriority('scroll-snap-type')};
e.style.setProperty('scroll-snap-type','none','important');
return old;
}
function thaw(e,old){
if(!old)return;
if(old.v)e.style.setProperty('scroll-snap-type',old.v,old.p);else e.style.removeProperty('scroll-snap-type');
}
function points(e,x){
var c=getComputedStyle(e),pad=parseFloat(x?c.scrollPaddingLeft:c.scrollPaddingTop)||0,now=pos(e,x),out=[];
var r=e.getBoundingClientRect(),o=e===doc?0:(x?r.left+e.clientLeft:r.top+e.clientTop),view=x?e.clientWidth:e.clientHeight;
e.querySelectorAll('*').forEach(function(k){
var a=getComputedStyle(k).scrollSnapAlign;
if(!a||a==='none')return;
var w=a.split(' ');a=x?w[w.length-1]:w[0];
if(a==='none')return;
var b=k.getBoundingClientRect(),s=(x?b.left:b.top)-o,z=x?b.width:b.height;
var off=a==='center'?s+z/2-view/2:a==='end'?s+z-view:s-pad;
out.push(clamp(now+off,0,max(e,x)));
});
return out;
}
function target(e,x,v){
var now=pos(e,x),aim=now+v*180,all=points(e,x),list=all;
if(!all.length)return null;
if(Math.abs(v)>.2){var ahead=all.filter(function(p){return v>0?p>now+1:p<now-1});if(ahead.length)list=ahead}
return list.reduce(function(b,p){return Math.abs(p-aim)<Math.abs(b-aim)?p:b},list[0]);
}
function run(step,done){
var j={id:0,done:done};
function f(t){if(job!==j)return;if(step(t)){j.id=requestAnimationFrame(f)}else{job=null;done()}}
job=j;j.id=requestAnimationFrame(f);
}
function halt(){if(!job)return false;var j=job;job=null;cancelAnimationFrame(j.id);j.done();return true}
function settle(e,x,to,old){
var from=pos(e,x),t0=performance.now();
run(function(t){var k=clamp((t-t0)/280,0,1);put(e,x,from+(to-from)*(1-Math.pow(1-k,3)));return k<1},function(){put(e,x,to);thaw(e,old)});
}
function glide(e,x,v){
var p=pos(e,x),last=performance.now();
run(function(t){var dt=t-last;last=t;v*=Math.pow(.9968,dt);p+=v*dt;var m=max(e,x);if(p<=0||p>=m){put(e,x,clamp(p,0,m));return false}put(e,x,p);return Math.abs(v)>.02},function(){});
}
function speed(d,t){
var s=d.marks.filter(function(m){return t-m.t<100});
if(s.length<2||t-s[s.length-1].t>80)return 0;
var a=s[0],b=s[s.length-1];
return b.t>a.t?-(b.p-a.p)/(b.t-a.t):0;
}
function finish(ev){
if(!press||ev.pointerId!==press.id)return;
var d=drag;press=null;drag=null;mode(ev.altKey?'text':'up');
if(!d||!d.el)return;
var v=speed(d,ev.timeStamp);
if(d.old){var to=target(d.el,d.x,v);if(to!==null){settle(d.el,d.x,to,d.old);return}thaw(d.el,d.old)}
if(Math.abs(v)>.05)glide(d.el,d.x,v);
}
addEventListener('pointerdown',function(ev){
if(ev.pointerType!=='mouse'||ev.button!==0)return;
swallow=halt();
var t=ev.target;
if(ev.altKey||(t.closest&&t.closest('input,textarea,select,[contenteditable]'))){mode('text');return}
press={id:ev.pointerId,x:ev.clientX,y:ev.clientY,t:t};mode('down');
},true);
addEventListener('pointermove',function(ev){
if(ev.pointerType!=='mouse')return;
if(!press){if(!ev.buttons)mode(ev.altKey?'text':'up');return}
if(ev.pointerId!==press.id)return;
if(!(ev.buttons&1)){finish(ev);return}
var dx=ev.clientX-press.x,dy=ev.clientY-press.y;
if(!drag){
if(Math.abs(dx)<6&&Math.abs(dy)<6)return;
var x=Math.abs(dx)>Math.abs(dy),el=find(press.t,x,x?-dx:-dy);
drag={el:el,x:x,base:el?pos(el,x):0,start:x?ev.clientX:ev.clientY,marks:[],old:el?freeze(el):null};
swallow=true;
try{root.setPointerCapture(ev.pointerId)}catch(e){}
}
ev.preventDefault();
if(!drag.el)return;
var at=drag.x?ev.clientX:ev.clientY;
put(drag.el,drag.x,drag.base-(at-drag.start));
drag.marks.push({t:ev.timeStamp,p:at});
if(drag.marks.length>12)drag.marks.shift();
},true);
addEventListener('pointerup',finish,true);
addEventListener('pointercancel',finish,true);
addEventListener('click',function(ev){if(swallow){swallow=false;ev.preventDefault();ev.stopPropagation()}},true);
addEventListener('dragstart',function(ev){if(!ev.altKey)ev.preventDefault()},true);
})();`;

/** Pure: the page with finger mode added before its last </body>, and its links between pages keeping it. */
export function withFinger(html: string, kind: string): string {
  if (kind !== "page") return html;
  const linked = html.replace(/\bhref\s*=\s*(["'])\?([^"']*)\1/gi, (_all, q: string, s: string) => `href=${q}?${s ? `${s}&` : ""}finger=1${q}`);
  const add = `<style>${CSS}</style><script>${JS}</script>`;
  const end = [...linked.matchAll(/<\/body\s*>/gi)].pop()?.index;
  return end === undefined ? linked + add : linked.slice(0, end) + add + linked.slice(end);
}
