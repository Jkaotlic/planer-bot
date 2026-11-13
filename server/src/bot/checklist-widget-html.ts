export const checklistWidgetHtml = `<style>
body{margin:0;padding:12px;font-family:system-ui;color:var(--tg-theme-text-color)}
h3,p{margin:0}h3{font-size:1.14em;overflow-wrap:anywhere;margin:4px 0 8px}
.meta,#status{font-size:.84em;color:var(--tg-theme-hint-color)}
.head,.nav{display:flex;justify-content:space-between;align-items:center;gap:6px}
#intro{padding:8px 10px;margin-bottom:10px;border-left:3px solid var(--tg-theme-link-color);background:var(--tg-theme-secondary-bg-color);font-size:.9em;overflow-wrap:anywhere}
#progress{font-weight:650;font-size:.94em}
.track{height:5px;background:var(--tg-theme-secondary-bg-color);border-radius:4px;margin:6px 0 10px;overflow:hidden}
#bar{height:100%;background:var(--tg-theme-link-color)}
.item{display:flex;align-items:center;gap:9px;box-sizing:border-box;width:100%;text-align:left;margin:5px 0;min-height:44px;padding:8px 10px;white-space:normal}
.item-label{min-width:0;overflow-wrap:anywhere}
.box{display:grid;place-items:center;flex:0 0 20px;height:20px;box-sizing:border-box;border:1px solid var(--tg-theme-hint-color);border-radius:5px}
.checked .box{border-color:var(--tg-theme-button-color);background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
button{font:inherit;border:0;border-radius:8px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.nav{margin-top:8px}.nav button{padding:7px 9px;color:var(--tg-theme-link-color)}
#refresh{margin-left:auto}button[hidden]{display:none}
#status{margin-top:6px}button:disabled{color:var(--tg-theme-hint-color)}
</style>
<section>
  <div class="head meta"><span>Чек-лист дежурного</span><span id="date"></span></div>
  <h3 id="name"></h3>
  <p id="intro" hidden></p>
  <p id="progress"></p>
  <div class="track"><div id="bar"></div></div>
  <div id="items"></div>
  <p id="hint" class="meta">Нажми на пункт, чтобы отметить.</p>
  <div class="nav">
    <button id="prev" aria-label="Предыдущая страница">‹</button>
    <span id="page" class="meta"></span>
    <button id="next" aria-label="Следующая страница">›</button>
    <button id="refresh">Обновить</button>
  </div>
  <p id="status"></p>
</section>
<script>
(function(){
  const W = window.TelegramWidget;
  if (!W) return;
  const el = id => document.getElementById(id);
  let state = JSON.parse(W.chatData || "null");
  if (!state) return;
  let busy = false;
  let disabled = false;
  let lastRefresh = 0;
  function render() {
    el("date").textContent = state.date;
    el("name").textContent = state.name;
    el("intro").textContent = state.intro || "";
    el("intro").hidden = !state.intro || disabled;
    el("progress").textContent = state.done === state.total ? "Всё выполнено · " + state.total + " из " + state.total : "Выполнено " + state.done + " из " + state.total;
    el("bar").style.width = (100 * state.done / state.total) + "%";
    el("page").textContent = (state.page + 1) + " / " + state.pages;
    el("page").hidden = el("prev").hidden = el("next").hidden = state.pages <= 1 || disabled;
    el("prev").disabled = busy || disabled || state.page === 0;
    el("next").disabled = busy || disabled || state.page + 1 === state.pages;
    el("refresh").disabled = busy || disabled;
    el("hint").hidden = disabled || state.done === state.total;
    el("items").textContent = "";
    if (disabled) return;
    state.items.forEach(item => {
      const button = document.createElement("button");
      button.className = item[2] ? "item checked" : "item";
      button.setAttribute("aria-pressed", String(item[2]));
      const box = document.createElement("span");
      box.className = "box";
      box.textContent = item[2] ? "✓" : "";
      const title = document.createElement("span");
      title.className = "item-label";
      title.textContent = item[1];
      button.appendChild(box);
      button.appendChild(title);
      button.disabled = busy;
      button.onclick = () => ask("m" + item[0] + "." + (item[2] ? "0" : "1"));
      el("items").appendChild(button);
    });
  }
  async function ask(action) {
    if (busy || disabled) return;
    busy = true;
    render();
    el("status").textContent = "Обновляю…";
    try {
      const response = await W.request(state.scope + ":" + action);
      const value = JSON.parse(response.result);
      if (value.error) {
        disabled = !!value.disabled;
        el("status").textContent = value.error;
      } else {
        state = value;
        el("status").textContent = "";
      }
    } catch {
      el("status").textContent = "Связь прервалась. Нажми «Обновить», чтобы проверить отметки.";
    } finally {
      busy = false;
      render();
    }
  }
  function refreshOnOpen() {
    if (Date.now() - lastRefresh < 5000) return;
    lastRefresh = Date.now();
    ask("p" + state.page);
  }
  el("prev").onclick = () => ask("p" + (state.page - 1));
  el("next").onclick = () => ask("p" + (state.page + 1));
  el("refresh").onclick = () => ask("p" + state.page);
  W.onEvent("activated", refreshOnOpen);
  render();
  W.ready();
  refreshOnOpen();
})();
</script>`;
