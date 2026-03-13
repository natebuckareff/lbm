import { animate, resetSimulation } from "./animate";
import { CHUNK_SIZE, DEFAULT_TAU, MAX_TAU, MIN_TAU } from "./sim/constants";
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
const simulationResetButton =
  document.querySelector<HTMLButtonElement>(".simulation-reset");
const viewResetButton =
  document.querySelector<HTMLButtonElement>(".view-reset");
const gridWidthInput =
  document.querySelector<HTMLInputElement>(".grid-width-input");
const gridHeightInput =
  document.querySelector<HTMLInputElement>(".grid-height-input");
const visualizationModeSelect =
  document.querySelector<HTMLSelectElement>(".visualization-mode");
const tauSlider = document.querySelector<HTMLInputElement>(".tau-slider");
const tauValue = document.querySelector<HTMLElement>(".tau-value");
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
  !simulationResetButton ||
  !viewResetButton ||
  !gridWidthInput ||
  !gridHeightInput ||
  !visualizationModeSelect ||
  !tauSlider ||
  !tauValue ||
  !chunkGridToggle
) {
  throw new Error("Expected app layout elements in index.html");
}

const DEFAULT_GRID_WIDTH = 256;
const DEFAULT_GRID_HEIGHT = 256;
const MIN_GRID_SIZE = 32;
const MAX_GRID_SIZE = 1024;
const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 32;
const ZOOM_STEP = 0.0015;
const CANVAS_FIT_HORIZONTAL_PADDING = 32;

const context = mainCanvas.getContext("2d");

if (!context) {
  throw new Error("Expected 2D canvas context");
}

context.imageSmoothingEnabled = false;

type MutableAnimationBuffer = {
  height: number;
  pixels: Uint8ClampedArray;
  width: number;
};

let gridWidth = DEFAULT_GRID_WIDTH;
let gridHeight = DEFAULT_GRID_HEIGHT;
let pixelBytes = new Uint8ClampedArray(gridWidth * gridHeight * 4);
let pixelImage = new ImageData(pixelBytes, gridWidth, gridHeight);
let animationBuffer: MutableAnimationBuffer = {
  height: gridHeight,
  pixels: pixelBytes,
  width: gridWidth,
};
let visualizationMode: VisualizationMode = "speed";
let tau = DEFAULT_TAU;
let isChunkGridVisible = false;

const setCanvasDimensions = (width: number, height: number) => {
  mainCanvas.width = width;
  mainCanvas.height = height;
  mainCanvas.style.width = `${width}px`;
  mainCanvas.style.height = `${height}px`;
};

const recreateFrameBuffer = (width: number, height: number) => {
  gridWidth = width;
  gridHeight = height;
  pixelBytes = new Uint8ClampedArray(width * height * 4);
  pixelImage = new ImageData(pixelBytes, width, height);
  animationBuffer = {
    height,
    pixels: pixelBytes,
    width,
  };
  setCanvasDimensions(width, height);
};

const clampGridSize = (value: number) => {
  const clamped = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, value));
  return Math.round(clamped / CHUNK_SIZE) * CHUNK_SIZE;
};

gridWidthInput.min = String(MIN_GRID_SIZE);
gridWidthInput.max = String(MAX_GRID_SIZE);
gridWidthInput.step = String(CHUNK_SIZE);
gridWidthInput.value = String(DEFAULT_GRID_WIDTH);

gridHeightInput.min = String(MIN_GRID_SIZE);
gridHeightInput.max = String(MAX_GRID_SIZE);
gridHeightInput.step = String(CHUNK_SIZE);
gridHeightInput.value = String(DEFAULT_GRID_HEIGHT);

recreateFrameBuffer(DEFAULT_GRID_WIDTH, DEFAULT_GRID_HEIGHT);

const presentPixels = () => {
  context.putImageData(pixelImage, 0, 0);
};

const renderChunkGrid = () => {
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.28)";
  context.lineWidth = 1;
  context.beginPath();

  for (let x = CHUNK_SIZE; x < gridWidth; x += CHUNK_SIZE) {
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, gridHeight);
  }

  for (let y = CHUNK_SIZE; y < gridHeight; y += CHUNK_SIZE) {
    context.moveTo(0, y + 0.5);
    context.lineTo(gridWidth, y + 0.5);
  }

  context.stroke();
  context.restore();
};

const renderCurrentFrame = (dt: number) => {
  animate(animationBuffer, dt, { tau, visualizationMode });
  presentPixels();

  if (isChunkGridVisible) {
    renderChunkGrid();
  }
};

const applyPendingGridSize = () => {
  const nextWidth = clampGridSize(Number.parseInt(gridWidthInput.value, 10));
  const nextHeight = clampGridSize(Number.parseInt(gridHeightInput.value, 10));

  gridWidthInput.value = String(nextWidth);
  gridHeightInput.value = String(nextHeight);

  recreateFrameBuffer(nextWidth, nextHeight);
  resetSimulation();
  renderCurrentFrame(0);
  resetCanvasView();
};

let isAnimationRunning = true;
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
  const x = (workspaceView.clientWidth - gridWidth * scale) * 0.5;
  const y = (workspaceView.clientHeight - gridHeight * scale) * 0.5;
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

  return clampCanvasScale(availableWidth / gridWidth);
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

simulationResetButton.addEventListener("click", () => {
  applyPendingGridSize();
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

const formatTau = (value: number) => value.toFixed(2);

tauSlider.min = String(MIN_TAU);
tauSlider.max = String(MAX_TAU);
tauSlider.step = "0.01";
tauSlider.value = String(DEFAULT_TAU);
tauValue.textContent = formatTau(DEFAULT_TAU);

tauSlider.addEventListener("input", () => {
  const nextTau = Number.parseFloat(tauSlider.value);

  if (!Number.isFinite(nextTau)) {
    return;
  }

  tau = Math.max(MIN_TAU, Math.min(MAX_TAU, nextTau));
  tauValue.textContent = formatTau(tau);
  renderCurrentFrame(0);
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
renderCurrentFrame(0);
requestAnimationFrame(frame);
