export const checklistWidgetHtml = `<style>
body{margin:0;padding:12px;font-family:system-ui;color:var(--tg-theme-text-color)}
h3,p{margin:0}h3{font-size:1.06em;overflow-wrap:anywhere}
.meta,#status{font-size:.84em;color:var(--tg-theme-hint-color)}
.head,.nav{display:flex;justify-content:space-between;align-items:center;gap:6px}
.track{height:5px;background:var(--tg-theme-secondary-bg-color);border-radius:4px;margin:8px 0 10px;overflow:hidden}
#bar{height:100%;background:var(--tg-theme-link-color)}
.item{display:block;box-sizing:border-box;width:100%;text-align:left;margin:4px 0;min-height:39px;padding:8px;overflow-wrap:anywhere;white-space:normal}
button{font:inherit;border:0;border-radius:8px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.nav{margin-top:8px}.nav button{padding:7px 9px;color:var(--tg-theme-link-color)}
#status{margin-top:6px}button:disabled{color:var(--tg-theme-hint-color)}
</style>
<section>
  <div class="head meta"><span>Чек-лист дежурного</span><span id="date"></span></div>
  <h3 id="name"></h3>
  <p id="progress" class="meta"></p>
  <div class="track"><div id="bar"></div></div>
  <div id="items"></div>
  <div class="nav">
    <button id="prev" aria-label="Предыдущая страница">‹</button>
    <span id="page" class="meta"></span>
    <button id="next" aria-label="Следующая страница">›</button>
    <button id="refresh" aria-label="Обновить отметки">↻</button>
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
    el("progress").textContent = state.done === state.total ? "Готово · " + state.done + " из " + state.total : state.done + " из " + state.total + " выполнено";
    el("bar").style.width = (100 * state.done / state.total) + "%";
    el("page").textContent = (state.page + 1) + " / " + state.pages;
    el("prev").disabled = busy || disabled || state.page === 0;
    el("next").disabled = busy || disabled || state.page + 1 === state.pages;
    el("refresh").disabled = busy || disabled;
    el("items").textContent = "";
    if (disabled) return;
    state.items.forEach(item => {
      const button = document.createElement("button");
      button.className = "item";
      button.textContent = (item[2] ? "✓  " : "○  ") + item[1];
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
      el("status").textContent = "Связь прервалась. Нажми ↻, чтобы проверить отметки.";
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
