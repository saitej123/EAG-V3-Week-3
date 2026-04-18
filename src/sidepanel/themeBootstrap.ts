/** CSP-safe theme sync (no inline scripts in HTML). */
export function initSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.classList.toggle("dark", mq.matches);
  };
  apply();
  mq.addEventListener("change", apply);
}

initSystemTheme();
