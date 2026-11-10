/**
 * Профиль 1 Telegram: без сети и внешних ресурсов. Персональные данные идут
 * только в chat_data, никогда не подставляются в неизменяемый HTML.
 */
export const myWeekHtml = String.raw`<style>
body{margin:0;padding:12px 12px calc(12px + env(safe-area-inset-bottom));font-family:system-ui;color:var(--tg-theme-text-color)}
*{box-sizing:border-box}#days[hidden],#detail[hidden],#entries[hidden]{display:none}button{font:inherit;border:0;cursor:pointer;color:var(--tg-theme-link-color);background:var(--tg-theme-secondary-bg-color);border-radius:10px;min-height:40px}
.head,.nav,.entry-nav,.bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}.head strong{font-size:18px}.head button{background:transparent;font-size:12px;padding:4px}.nav{margin:10px 0}.nav button{width:40px;background:transparent;font-size:24px}.nav strong{font-size:14px;text-align:center}
#days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.day{color:var(--tg-theme-text-color);background:transparent;border:2px solid transparent;padding:6px 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px}.day[aria-pressed=true]{border-color:var(--tg-theme-link-color);background:var(--tg-theme-secondary-bg-color)}.dow{font-size:11px;color:var(--tg-theme-hint-color)}.num{font-size:16px;font-weight:600}.mark{height:5px;width:19px;border-radius:3px}.code{font-size:11px;min-height:14px}
#detail{margin-top:15px;border-top:1px solid var(--tg-theme-section-separator-color,var(--tg-theme-hint-color));padding:14px 0 8px;min-height:140px;overflow-wrap:anywhere}#date,#hint,#location,#status,.bottom{color:var(--tg-theme-hint-color);font-size:12px}#title{font-weight:600;font-size:18px;margin-top:7px}#title,#location{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}#time{font-size:21px;font-weight:600;margin:3px 0}#hint,#location{margin-top:5px}.entry-nav{justify-content:center;margin:4px 0}.entry-nav button{width:40px}.bottom{margin-top:8px}.bottom button{padding:5px 10px;font-size:12px;background:transparent}#status{margin-top:6px;min-height:18px}button:disabled{cursor:default}
@media(max-width:260px){body{padding:10px 6px calc(10px + env(safe-area-inset-bottom))}#days{gap:0}.day{padding:5px 0}.code{font-size:10px}.nav{gap:2px}}
</style>
<div class="head"><strong>Моя неделя</strong><button id="today">К сегодня</button></div>
<div class="nav"><button id="prev" aria-label="Предыдущая неделя">‹</button><strong id="range"></strong><button id="next" aria-label="Следующая неделя">›</button></div>
<div id="days" role="group" aria-label="Дни недели"></div>
<div id="detail" aria-live="polite"><div id="date"></div><div id="title"></div><div id="time"></div><div id="location"></div><div id="hint"></div></div>
<div class="entry-nav" id="entries"><button id="entry-prev" aria-label="Предыдущая запись">‹</button><span id="counter"></span><button id="entry-next" aria-label="Следующая запись">›</button></div>
<div class="bottom"><span>Личный график</span><button id="refresh">↻ Обновить</button></div><div id="status" role="status"></div>
<script>
(function(){
var W=window.TelegramWidget;if(!W)return;
var s=null,busy=false,revoked=false,lastAuto=0;
var $=function(id){return document.getElementById(id)},days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
function add(date,n){var d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function fmt(date,options){return new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',Object.assign({timeZone:'UTC'},options))}
function request(m,d,p){return 'mw:'+m+':'+d+':'+p}
function controls(){document.querySelectorAll('button').forEach(function(b){b.disabled=busy||revoked});if(!s||revoked){$('refresh').disabled=busy;return}$('entry-prev').disabled=busy||s.p===0;$('entry-next').disabled=busy||s.p>=s.n-1;var base=add(s.t,-((new Date(s.t+'T12:00:00Z').getUTCDay()+6)%7));$('prev').disabled=busy||s.m<=add(base,-364);$('next').disabled=busy||s.m>=add(base,364)}
function render(){
try{var value=JSON.parse(W.chatData);if(!value||value.v!==1)throw Error();s=value;revoked=false}catch(e){$('status').textContent='Открой новую карточку командой /myweek';return}
$('days').hidden=false;$('detail').hidden=false;
var end=add(s.m,6);$('range').textContent=fmt(s.m,{day:'numeric',month:'short'})+' – '+fmt(end,{day:'numeric',month:'short',year:'numeric'});
$('days').textContent='';
days.forEach(function(name,i){var date=add(s.m,i),b=document.createElement('button');b.className='day';b.setAttribute('aria-pressed',String(i===s.d));b.setAttribute('aria-label',fmt(date,{weekday:'long',day:'numeric',month:'long'})+(date===s.t?', сегодня':''));
var dow=document.createElement('span');dow.className='dow';dow.textContent=name;
var num=document.createElement('span');num.className='num';num.textContent=String(Number(date.slice(8)));
var mark=document.createElement('span');mark.className='mark';mark.style.background=s.c[i]&&s.c[i][0]||'var(--tg-theme-hint-color)';
var code=document.createElement('span');code.className='code';code.textContent=s.c[i]?s.c[i][1]:'—';b.appendChild(dow);b.appendChild(num);b.appendChild(mark);b.appendChild(code);b.onclick=function(){ask(request(s.m,i,0))};$('days').appendChild(b)});
var date=add(s.m,s.d);$('date').textContent=fmt(date,{weekday:'long',day:'numeric',month:'long'})+(date===s.t?' · сегодня':'');$('title').textContent=s.e.title;$('time').textContent=s.e.time;$('location').textContent=s.e.location;$('hint').textContent=s.e.hint;
$('entries').hidden=s.n<2;$('counter').textContent=(s.p+1)+' из '+s.n;controls()
}
function ask(data){if(busy)return;busy=true;controls();$('status').textContent='Обновляю…';
W.request(data).then(function(answer){var a=null;try{a=JSON.parse(answer.result)}catch(e){}if(a&&a.error){$('status').textContent=a.error;if(a.disabled){revoked=true;$('days').hidden=true;$('detail').hidden=true;$('entries').hidden=true;$('range').textContent='';$('title').textContent='';$('time').textContent='';$('location').textContent='';$('hint').textContent='';$('date').textContent=''}}else{$('status').textContent=''}}).catch(function(){$('status').textContent='Не удалось обновить. Нажми «Обновить» или открой мини-апп.'}).finally(function(){busy=false;controls()})
}
$('prev').onclick=function(){if(s)ask(request(add(s.m,-7),s.d,0))};$('next').onclick=function(){if(s)ask(request(add(s.m,7),s.d,0))};$('today').onclick=function(){ask('mw:today')};$('refresh').onclick=function(){ask(s&&!revoked?request(s.m,s.d,s.p):'mw:today')};$('entry-prev').onclick=function(){if(s)ask(request(s.m,s.d,s.p-1))};$('entry-next').onclick=function(){if(s)ask(request(s.m,s.d,s.p+1))};
function auto(){if(Date.now()-lastAuto<5000||busy)return;lastAuto=Date.now();ask(s&&!revoked?request(s.m,s.d,s.p):'mw:today')}
W.onEvent('chatDataChanged',render);W.onEvent('activated',auto);render();W.ready();auto()
})();
</script>`;
