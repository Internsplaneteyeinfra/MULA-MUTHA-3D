/**
 * Lucide icon → SVG HTML (vanilla; no React).
 * Shape: ["svg", attrs, [ ["path", attrs], ... ]]
 */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function elementToHtml(el) {
  if (el == null) return "";
  if (typeof el === "string" || typeof el === "number") return String(el);
  if (!Array.isArray(el) || typeof el[0] !== "string") return "";

  const [tag, attrs = {}, child] = el;
  let inner = "";
  if (Array.isArray(child)) {
    inner =
      typeof child[0] === "string"
        ? elementToHtml(child)
        : child.map(elementToHtml).join("");
  } else if (child != null) {
    inner = elementToHtml(child);
  }

  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${escapeAttr(v)}"`))
    .join(" ");

  return attrStr ? `<${tag} ${attrStr}>${inner}</${tag}>` : `<${tag}>${inner}</${tag}>`;
}

/** @param {unknown} icon Lucide icon node */
export function lucideHtml(icon, { size = 16, strokeWidth = 1.75, className = "lp-icon" } = {}) {
  if (!Array.isArray(icon) || icon[0] !== "svg") return "";
  const children = icon[2];
  const inner = Array.isArray(children)
    ? typeof children[0] === "string"
      ? elementToHtml(children)
      : children.map(elementToHtml).join("")
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${inner}</svg>`;
}
