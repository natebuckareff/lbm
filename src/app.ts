const appRoot = document.querySelector<HTMLDivElement>("#app");
const shell = document.querySelector<HTMLElement>(".app-shell");
const sidePanel = document.querySelector<HTMLElement>(".side-panel");
const contentPanel = document.querySelector<HTMLElement>(".content-panel");
const panelToggle = document.querySelector<HTMLButtonElement>(".panel-toggle");
const inspectorPanel = document.querySelector<HTMLElement>(".inspector-panel");
const inspectorResizeHandle =
  document.querySelector<HTMLButtonElement>(".inspector-bar");

if (!appRoot) {
  throw new Error("Expected #app mount element");
}

if (
  !shell ||
  !sidePanel ||
  !contentPanel ||
  !panelToggle ||
  !inspectorPanel ||
  !inspectorResizeHandle
) {
  throw new Error("Expected app layout elements in index.html");
}

const setCollapsed = (collapsed: boolean) => {
  shell.classList.toggle("is-collapsed", collapsed);
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggle.textContent = collapsed ? ">" : "Collapse";
};

panelToggle.addEventListener("click", () => {
  setCollapsed(!shell.classList.contains("is-collapsed"));
});

const COLLAPSED_INSPECTOR_HEIGHT = 24;
const MIN_EXPANDED_INSPECTOR_HEIGHT = 96;
const DEFAULT_INSPECTOR_HEIGHT = 180;
const INSPECTOR_RESERVED_CHROME = 24;

const clampInspectorHeight = (height: number) => {
  const availableHeight = contentPanel.clientHeight - INSPECTOR_RESERVED_CHROME;
  return Math.max(COLLAPSED_INSPECTOR_HEIGHT, Math.min(height, availableHeight));
};

const isInspectorCollapsed = () =>
  inspectorPanel.classList.contains("is-collapsed");

const setInspectorHeight = (height: number) => {
  const clampedHeight = clampInspectorHeight(height);
  const collapsed = clampedHeight <= MIN_EXPANDED_INSPECTOR_HEIGHT;
  inspectorPanel.classList.toggle("is-collapsed", collapsed);

  if (collapsed) {
    inspectorPanel.style.setProperty(
      "--inspector-height",
      `${COLLAPSED_INSPECTOR_HEIGHT}px`,
    );
    return;
  }

  inspectorPanel.style.setProperty("--inspector-height", `${clampedHeight}px`);
};

let lastExpandedInspectorHeight = DEFAULT_INSPECTOR_HEIGHT;

const getExpandedInspectorHeight = () => {
  const rawHeight = Number.parseFloat(
    inspectorPanel.style.getPropertyValue("--inspector-height"),
  );

  if (Number.isFinite(rawHeight) && rawHeight > MIN_EXPANDED_INSPECTOR_HEIGHT) {
    return rawHeight;
  }

  return lastExpandedInspectorHeight;
};

const toggleInspectorCollapsed = () => {
  if (isInspectorCollapsed()) {
    setInspectorHeight(getExpandedInspectorHeight());
    return;
  }

  const currentHeight = getExpandedInspectorHeight();
  if (currentHeight > MIN_EXPANDED_INSPECTOR_HEIGHT) {
    lastExpandedInspectorHeight = currentHeight;
  }
  setInspectorHeight(COLLAPSED_INSPECTOR_HEIGHT);
};

inspectorResizeHandle.addEventListener("pointerdown", (event) => {
  const pointerId = event.pointerId;
  const startY = event.clientY;
  const startHeight = isInspectorCollapsed()
    ? lastExpandedInspectorHeight
    : getExpandedInspectorHeight();

  inspectorResizeHandle.setPointerCapture(pointerId);

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const deltaY = startY - moveEvent.clientY;
    const nextHeight = clampInspectorHeight(startHeight + deltaY);

    if (nextHeight <= MIN_EXPANDED_INSPECTOR_HEIGHT) {
      setInspectorHeight(COLLAPSED_INSPECTOR_HEIGHT);
      return;
    }

    lastExpandedInspectorHeight = nextHeight;
    setInspectorHeight(nextHeight);
  };

  const handlePointerEnd = () => {
    inspectorResizeHandle.releasePointerCapture(pointerId);
    inspectorResizeHandle.removeEventListener("pointermove", handlePointerMove);
    inspectorResizeHandle.removeEventListener("pointerup", handlePointerEnd);
    inspectorResizeHandle.removeEventListener("pointercancel", handlePointerEnd);
  };

  inspectorResizeHandle.addEventListener("pointermove", handlePointerMove);
  inspectorResizeHandle.addEventListener("pointerup", handlePointerEnd);
  inspectorResizeHandle.addEventListener("pointercancel", handlePointerEnd);
});

inspectorResizeHandle.addEventListener("dblclick", (event) => {
  event.preventDefault();
  toggleInspectorCollapsed();
});

setCollapsed(false);
setInspectorHeight(COLLAPSED_INSPECTOR_HEIGHT);
