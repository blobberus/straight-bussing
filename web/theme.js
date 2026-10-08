/* Theme: Auto (follows system) / Light / Dark.
   window.Theme = { get(), set(mode), onChange(cb), isDark(), mount(el) } */
(function () {
  "use strict";
  var KEY = "sb-theme", MODES = ["auto", "light", "dark"];
  var mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false };
  var root = document.documentElement, cbs = [], mode = "auto", last;

  try { var saved = localStorage.getItem(KEY); if (MODES.indexOf(saved) >= 0) mode = saved; } catch (e) {}

  function isDark() { return mode === "dark" || (mode === "auto" && !!mq.matches); }

  function paint() {
    if (mode === "auto") delete root.dataset.theme; else root.dataset.theme = mode;
    root.style.colorScheme = mode === "auto" ? "light dark" : mode;
    // keep the browser/status-bar color in sync with the in-app choice
    var dark = isDark();
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) { metas[i].setAttribute("content", dark ? "#1c1c1e" : "#f2f2f7"); metas[i].removeAttribute("media"); }
    if (metas.length > 1) for (var j = 1; j < metas.length; j++) metas[j].remove();
  }

  function fire() {
    var d = isDark();
    if (d === last) return;
    last = d;
    cbs.slice().forEach(function (cb) { try { cb(d, mode); } catch (e) {} });
  }

  paint(); last = isDark();
  var onSys = function () { if (mode === "auto") { paint(); fire(); } };
  if (mq.addEventListener) mq.addEventListener("change", onSys); else if (mq.addListener) mq.addListener(onSys);

  var mounted = [];
  function sync() { mounted.forEach(function (seg) { [].forEach.call(seg.querySelectorAll("button"), function (b) { var on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; }); }); }

  window.Theme = {
    get: function () { return mode; },
    isDark: isDark,
    set: function (m) {
      if (MODES.indexOf(m) < 0) return;
      mode = m;
      try { localStorage.setItem(KEY, m); } catch (e) {}
      paint(); sync(); fire();
    },
    onChange: function (cb) { if (typeof cb === "function") cbs.push(cb); },
    mount: function (el) {
      if (!el) return;
      var seg = document.createElement("div");
      seg.className = "themeseg"; seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", "Appearance");
      [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].forEach(function (p) {
        var b = document.createElement("button");
        b.type = "button"; b.dataset.mode = p[0]; b.textContent = p[1]; b.setAttribute("role", "radio");
        b.addEventListener("click", function () { window.Theme.set(p[0]); });
        b.addEventListener("keydown", function (e) {
          var i = MODES.indexOf(mode), n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (n) { e.preventDefault(); window.Theme.set(MODES[(i + n + 3) % 3]); var nb = seg.querySelector('[data-mode="' + mode + '"]'); if (nb) nb.focus(); }
        });
        seg.appendChild(b);
      });
      el.appendChild(seg); mounted.push(seg); sync();
    }
  };
})();
