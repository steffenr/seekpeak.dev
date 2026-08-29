(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const THEMES = window.__THEMES;
  const THEME_KEY = "deepseek-peak-theme";
  const THEME_DEFAULT = "monokai-pro";
  let theme = (() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return THEMES.some((t) => t.id === stored) ? stored : THEME_DEFAULT;
    } catch {
      return THEME_DEFAULT;
    }
  })();
  document.documentElement.setAttribute("data-theme", theme);

  const themeButton = $("#themeButton");
  const themePanel = $("#themePanel");
  const themeList = $("#themeList");
  const themePillLabel = $("#themePillLabel");

  function renderThemeList() {
    themeList.replaceChildren();
    for (const t of THEMES) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "flex w-full items-center justify-between border-b-2 border-black px-3 py-2 text-left text-sm font-bold uppercase tracking-wide transition-all last:border-b-0 " +
        (t.id === theme
          ? "bg-mk-yellow text-mk-ink"
          : "text-mk-fg hover:translate-x-[2px] hover:bg-mk-yellow/30") +
        " active:translate-x-[2px] active:bg-mk-yellow";
      const name = document.createElement("span");
      name.textContent = t.label;
      const sw = document.createElement("span");
      sw.className = "flex gap-1";
      for (const c of t.swatches) {
        const dot = document.createElement("span");
        dot.className = "h-3 w-3 border border-black";
        dot.style.backgroundColor = c;
        sw.append(dot);
      }
      btn.append(name, sw);
      btn.addEventListener("click", () => {
        theme = t.id;
        document.documentElement.setAttribute("data-theme", theme);
        try {
          localStorage.setItem(THEME_KEY, theme);
        } catch (e) {}
        renderThemePill();
        renderThemeList();
        closeThemePanel();
      });
      li.append(btn);
      themeList.append(li);
    }
  }

  function renderThemePill() {
    const current = THEMES.find((t) => t.id === theme) || THEMES[0];
    themePillLabel.textContent = current.label;
  }

  function openThemePanel() {
    themePanel.hidden = false;
    renderThemeList();
    themeButton.setAttribute("aria-expanded", "true");
  }

  function closeThemePanel() {
    themePanel.hidden = true;
    themeButton.setAttribute("aria-expanded", "false");
  }

  themeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    themePanel.hidden ? openThemePanel() : closeThemePanel();
  });

  document.addEventListener("click", (e) => {
    if (!themePanel.hidden && !themePanel.contains(e.target) && e.target !== themeButton) closeThemePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeThemePanel();
  });

  renderThemeList();
  renderThemePill();
})();
