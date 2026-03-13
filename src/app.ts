import { animate } from "./animate";
import { CHUNK_SIZE } from "./sim/constants";
import type { VisualizationMode } from "./sim/render";

const appRoot = document.querySelector<HTMLDivElement>("#app");
const shell = document.querySelector<HTMLElement>(".app-shell");
const sidePanel = document.querySelector<HTMLElement>(".side-panel");
const contentPanel = document.querySelector<HTMLElement>(".content-panel");
const panelToggle = document.querySelector<HTMLButtonElement>(".panel-toggle");
const inspectorPanel = document.querySelector<HTMLElement>(".inspector-panel");
const inspectorResizeHandle =
  document.querySelector<HTMLButtonElement>(".inspector-bar");
const workspaceView = document.querySelector<HTMLElement>(".workspace-view");
const canvasStage = document.querySelector<HTMLElement>(".canvas-stage");
const mainCanvas = document.querySelector<HTMLCanvasElement>(".main-canvas");
const animationToggleButton =
  document.querySelector<HTMLButtonElement>(".animation-toggle");
const viewResetButton =
  document.querySelector<HTMLButtonElement>(".view-reset");
const visualizationModeSelect =
  document.querySelector<HTMLSelectElement>(".visualization-mode");
const chunkGridToggle =
  document.querySelector<HTMLInputElement>(".chunk-grid-toggle");

if (!appRoot) {
  throw new Error("Expected #app mount element");
}

if (
  !shell ||
  !sidePanel ||
  !contentPanel ||
  !panelToggle ||
  !inspectorPanel ||
  !inspectorResizeHandle ||
  !workspaceView ||
  !canvasStage ||
  !mainCanvas ||
  !animationToggleButton ||
  !viewResetButton ||
  !visualizationModeSelect ||
  !chunkGridToggle
) {
  throw new Error("Expected app layout elements in index.html");
}

const CANVAS_WIDTH = 128;
const CANVAS_HEIGHT = 128;
const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 32;
const ZOOM_STEP = 0.0015;
const CANVAS_FIT_HORIZONTAL_PADDING = 32;

mainCanvas.width = CANVAS_WIDTH;
mainCanvas.height = CANVAS_HEIGHT;
mainCanvas.style.width = `${CANVAS_WIDTH}px`;
mainCanvas.style.height = `${CANVAS_HEIGHT}px`;

const context = mainCanvas.getContext("2d");

if (!context) {
  throw new Error("Expected 2D canvas context");
}

context.imageSmoothingEnabled = false;

const pixelBytes = new Uint8ClampedArray(CANVAS_WIDTH * CANVAS_HEIGHT * 4);
const pixelImage = new ImageData(pixelBytes, CANVAS_WIDTH, CANVAS_HEIGHT);
const animationBuffer = {
  height: CANVAS_HEIGHT,
  pixels: pixelBytes,
  width: CANVAS_WIDTH,
};
let visualizationMode: VisualizationMode = "speed";
let isChunkGridVisible = false;

const presentPixels = () => {
  context.putImageData(pixelImage, 0, 0);
};

const renderChunkGrid = () => {
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.28)";
  context.lineWidth = 1;
  context.beginPath();

  for (let x = CHUNK_SIZE; x < CANVAS_WIDTH; x += CHUNK_SIZE) {
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, CANVAS_HEIGHT);
  }

  for (let y = CHUNK_SIZE; y < CANVAS_HEIGHT; y += CHUNK_SIZE) {
    context.moveTo(0, y + 0.5);
    context.lineTo(CANVAS_WIDTH, y + 0.5);
  }

  context.stroke();
  context.restore();
};

const renderCurrentFrame = (dt: number) => {
  animate(animationBuffer, dt, { visualizationMode });
  presentPixels();

  if (isChunkGridVisible) {
    renderChunkGrid();
  }
};

let isAnimationRunning = false;
let lastFrameTime = performance.now();

const frame = (now: number) => {
  const dt = (now - lastFrameTime) * 0.001;
  lastFrameTime = now;

  if (isAnimationRunning) {
    renderCurrentFrame(dt);
  }
  requestAnimationFrame(frame);
};

let canvasOffsetX = 0;
let canvasOffsetY = 0;
let canvasScale = 1;
let isCanvasAutoFit = true;

const renderCanvasTransform = () => {
  canvasStage.style.transform = `translate(${canvasOffsetX}px, ${canvasOffsetY}px) scale(${canvasScale})`;
};

const setCanvasTransform = (x: number, y: number, scale: number) => {
  canvasOffsetX = x;
  canvasOffsetY = y;
  canvasScale = scale;
  renderCanvasTransform();
};

const clampCanvasScale = (scale: number) => {
  return Math.max(MIN_CANVAS_SCALE, Math.min(scale, MAX_CANVAS_SCALE));
};

const centerCanvasInWorkspace = (scale: number) => {
  const x = (workspaceView.clientWidth - CANVAS_WIDTH * scale) * 0.5;
  const y = (workspaceView.clientHeight - CANVAS_HEIGHT * scale) * 0.5;
  setCanvasTransform(x, y, scale);
};

const getCanvasWidthFitScale = () => {
  const availableWidth = Math.max(
    workspaceView.clientWidth - CANVAS_FIT_HORIZONTAL_PADDING * 2,
    0,
  );

  if (availableWidth <= 0) {
    return MIN_CANVAS_SCALE;
  }

  return clampCanvasScale(availableWidth / CANVAS_WIDTH);
};

const resetCanvasView = () => {
  isCanvasAutoFit = true;
  centerCanvasInWorkspace(getCanvasWidthFitScale());
};

const setCollapsed = (collapsed: boolean) => {
  shell.classList.toggle("is-collapsed", collapsed);
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggle.textContent = collapsed ? ">" : "Collapse";
};

panelToggle.addEventListener("click", () => {
  setCollapsed(!shell.classList.contains("is-collapsed"));
});

animationToggleButton.addEventListener("click", () => {
  isAnimationRunning = !isAnimationRunning;
  animationToggleButton.textContent = isAnimationRunning ? "Pause" : "Resume";
});

viewResetButton.addEventListener("click", () => {
  resetCanvasView();
});

visualizationModeSelect.addEventListener("change", () => {
  const nextMode = visualizationModeSelect.value;

  if (nextMode === "density" || nextMode === "speed") {
    visualizationMode = nextMode;
    renderCurrentFrame(0);
  }
});

chunkGridToggle.addEventListener("change", () => {
  isChunkGridVisible = chunkGridToggle.checked;
  renderCurrentFrame(0);
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

workspaceView.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startOffsetX = canvasOffsetX;
  const startOffsetY = canvasOffsetY;

  workspaceView.classList.add("is-panning");
  workspaceView.setPointerCapture(pointerId);

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    isCanvasAutoFit = false;
    setCanvasTransform(startOffsetX + deltaX, startOffsetY + deltaY, canvasScale);
  };

  const handlePointerEnd = () => {
    workspaceView.classList.remove("is-panning");
    workspaceView.releasePointerCapture(pointerId);
    workspaceView.removeEventListener("pointermove", handlePointerMove);
    workspaceView.removeEventListener("pointerup", handlePointerEnd);
    workspaceView.removeEventListener("pointercancel", handlePointerEnd);
  };

  workspaceView.addEventListener("pointermove", handlePointerMove);
  workspaceView.addEventListener("pointerup", handlePointerEnd);
  workspaceView.addEventListener("pointercancel", handlePointerEnd);
});

workspaceView.addEventListener("wheel", (event) => {
  event.preventDefault();

  const rect = workspaceView.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const zoomFactor = Math.exp(-event.deltaY * ZOOM_STEP);
  const nextScale = clampCanvasScale(canvasScale * zoomFactor);

  if (nextScale === canvasScale) {
    return;
  }

  isCanvasAutoFit = false;

  const canvasX = (mouseX - canvasOffsetX) / canvasScale;
  const canvasY = (mouseY - canvasOffsetY) / canvasScale;
  const nextOffsetX = mouseX - canvasX * nextScale;
  const nextOffsetY = mouseY - canvasY * nextScale;

  setCanvasTransform(nextOffsetX, nextOffsetY, nextScale);
});

const resizeObserver = new ResizeObserver(() => {
  if (isCanvasAutoFit) {
    resetCanvasView();
  }
});

resizeObserver.observe(workspaceView);

setCollapsed(false);
setInspectorHeight(COLLAPSED_INSPECTOR_HEIGHT);
resetCanvasView();
requestAnimationFrame(frame);
