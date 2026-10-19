// Superfences emits <pre class="mermaid"><code> with HTML-escaped text,
// so we must read textContent (decoded) and use mermaid.render().
// Works with instant navigation: re-render on every page change.
// Hardened: failed renders never leave orphan error blocks at page bottom.
let mermaidCounter = 0;
async function renderMermaid() {
  if (typeof mermaid === "undefined") return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "loose",
    suppressErrorRendering: true
  });
  // Purge orphan temp containers left by previous failed renders
  // (mermaid.render creates body-level divs; instant nav keeps them).
  document.querySelectorAll('div[id^="mermaid-"]').forEach((d) => {
    if (!d.closest("pre.mermaid")) d.remove();
  });
  const blocks = document.querySelectorAll("pre.mermaid");
  for (const pre of blocks) {
    if (pre.dataset.mermaidRendered === "true") continue;
    const code = pre.querySelector("code");
    const source = (code ? code.textContent : pre.textContent).trim();
    if (!source) continue;
    const id = "mermaid-" + mermaidCounter++;
    try {
      const { svg } = await mermaid.render(id, source);
      pre.innerHTML = svg;
      pre.dataset.mermaidRendered = "true";
      // mermaid.render also appends a hidden measuring div: remove it.
      const tmp = document.getElementById(id);
      if (tmp && !tmp.closest("pre.mermaid")) tmp.remove();
    } catch (e) {
      console.error("Mermaid render error:", e);
      // Never leave Mermaid's injected error block visible at page bottom.
      const tmp = document.getElementById(id);
      if (tmp) tmp.remove();
      pre.style.display = "none";
    }
  }
}
if (typeof document$ !== "undefined") {
  document$.subscribe(() => renderMermaid());
} else {
  document.addEventListener("DOMContentLoaded", renderMermaid);
}
