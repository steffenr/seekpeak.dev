// Single source of truth for the theme list, prepended to every page bundle by
// build.mjs. Each id needs a matching [data-theme=…] block in src/style.css.
window.__THEMES = [
  { id: "monokai-pro", label: "Monokai Pro", swatches: ["#fcfcfa", "#ffd866", "#ff6188", "#78dce8", "#a9dc76"] },
  { id: "solarized-dark", label: "Solarized Dark", swatches: ["#93a1a1", "#b58900", "#d33682", "#2aa198", "#859900"] },
  { id: "tokyo-night", label: "Tokyo Night", swatches: ["#c0caf5", "#e0af68", "#f7768e", "#7aa2f7", "#9ece6a"] },
  { id: "dracula", label: "Dracula", swatches: ["#f8f8f2", "#f1fa8c", "#ff79c6", "#8be9fd", "#50fa7b"] },
  { id: "one-dark", label: "One Dark", swatches: ["#abb2bf", "#e5c07b", "#e06c75", "#56b6c2", "#98c379"] },
  { id: "one-light", label: "One Light", swatches: ["#383a42", "#e5c07b", "#e45649", "#6bb4f5", "#50a14f"] },
  { id: "solarized-light", label: "Solarized Light", swatches: ["#586e75", "#b58900", "#e066a7", "#2aa198", "#859900"] },
  { id: "github-light", label: "GitHub Light", swatches: ["#1f2328", "#d4a72c", "#e05b63", "#5ba1ef", "#37a254"] },
];
