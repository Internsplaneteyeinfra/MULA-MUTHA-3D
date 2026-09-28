/** True while the Digital Twin workspace is active. */
export function isDigitalTwinActive() {
  return (
    document.body.classList.contains("dt-mode-active") ||
    !!document.getElementById("ui-root")?.classList.contains("dt-mode-active")
  );
}

/** Calls `cb` whenever Digital Twin mode switches off. */
export function onDigitalTwinExit(cb) {
  let wasActive = isDigitalTwinActive();
  const mo = new MutationObserver(() => {
    const active = isDigitalTwinActive();
    if (wasActive && !active) cb();
    wasActive = active;
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const uiRoot = document.getElementById("ui-root");
  if (uiRoot) mo.observe(uiRoot, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}
