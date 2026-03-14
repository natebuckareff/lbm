import {
  animate,
  inspectSimulationCell,
  inspectSimulationRun,
  resetSimulation,
  stepAnimation,
} from "./animate";
import {
  appendOrCoalesceRecordedAction,
  buildRecording,
  createRecorderState,
  nextRecordedActionPosition,
  parseSimulationRecording,
  type RecordedSimulationAction,
  type SimulationRecording,
} from "./recording";
import {
  CHUNK_SIZE,
  DEFAULT_GRAVITY,
  DEFAULT_ROTATION_DEGREES,
  DEFAULT_TAU,
  MAX_GRAVITY,
  MAX_ROTATION_DEGREES,
  MAX_TAU,
  MIN_GRAVITY,
  MIN_ROTATION_DEGREES,
  MIN_TAU,
} from "./sim/constants";
import type { VisualizationMode } from "./sim/render";
import type { CellDebugInfo, PhaseDiagnostics } from "./sim/types";

const appRoot = document.querySelector<HTMLDivElement>("#app");
const shell = document.querySelector<HTMLElement>(".app-shell");
const sidePanel = document.querySelector<HTMLElement>(".side-panel");
const contentPanel = document.querySelector<HTMLElement>(".content-panel");
const panelToggle = document.querySelector<HTMLButtonElement>(".panel-toggle");
const inspectorPanel = document.querySelector<HTMLElement>(".inspector-panel");
const inspectorResizeHandle =
  document.querySelector<HTMLButtonElement>(".inspector-bar");
const inspectorBody = document.querySelector<HTMLElement>(".inspector-body");
const workspaceView = document.querySelector<HTMLElement>(".workspace-view");
const canvasStage = document.querySelector<HTMLElement>(".canvas-stage");
const mainCanvas = document.querySelector<HTMLCanvasElement>(".main-canvas");
const animationToggleButton =
  document.querySelector<HTMLButtonElement>(".animation-toggle");
const simulationStepButton =
  document.querySelector<HTMLButtonElement>(".simulation-step");
const recordingToggleButton =
  document.querySelector<HTMLButtonElement>(".recording-toggle");
const recordingExportButton =
  document.querySelector<HTMLButtonElement>(".recording-export");
const replayOpenButton =
  document.querySelector<HTMLButtonElement>(".replay-open");
const replayStopButton =
  document.querySelector<HTMLButtonElement>(".replay-stop");
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
const gravitySlider = document.querySelector<HTMLInputElement>(".gravity-slider");
const gravityValue = document.querySelector<HTMLElement>(".gravity-value");
const rotationSlider = document.querySelector<HTMLInputElement>(".rotation-slider");
const rotationValue = document.querySelector<HTMLElement>(".rotation-value");
const chunkGridToggle =
  document.querySelector<HTMLInputElement>(".chunk-grid-toggle");
const interpolationToggle =
  document.querySelector<HTMLInputElement>(".interpolation-toggle");
const hashingToggle =
  document.querySelector<HTMLInputElement>(".hashing-toggle");
const diagnosticsToggle =
  document.querySelector<HTMLInputElement>(".diagnostics-toggle");
const recordingNameInput =
  document.querySelector<HTMLInputElement>(".recording-name-input");
const recordingStatus =
  document.querySelector<HTMLElement>(".recording-status");
const replayStatus =
  document.querySelector<HTMLElement>(".replay-status");
const replayModal =
  document.querySelector<HTMLElement>(".replay-modal");
const replayInput =
  document.querySelector<HTMLTextAreaElement>(".replay-input");
const replayError =
  document.querySelector<HTMLElement>(".replay-error");
const replayLoadButton =
  document.querySelector<HTMLButtonElement>(".replay-load");
const replayCancelButton =
  document.querySelector<HTMLButtonElement>(".replay-cancel");
const exportModal =
  document.querySelector<HTMLElement>(".export-modal");
const exportOutput =
  document.querySelector<HTMLTextAreaElement>(".export-output");
const exportStatus =
  document.querySelector<HTMLElement>(".export-status");
const exportCopyButton =
  document.querySelector<HTMLButtonElement>(".export-copy");
const exportCloseButton =
  document.querySelector<HTMLButtonElement>(".export-close");

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
  !inspectorBody ||
  !workspaceView ||
  !canvasStage ||
  !mainCanvas ||
  !animationToggleButton ||
  !simulationStepButton ||
  !recordingToggleButton ||
  !recordingExportButton ||
  !replayOpenButton ||
  !replayStopButton ||
  !simulationResetButton ||
  !viewResetButton ||
  !gridWidthInput ||
  !gridHeightInput ||
  !visualizationModeSelect ||
  !tauSlider ||
  !tauValue ||
  !gravitySlider ||
  !gravityValue ||
  !rotationSlider ||
  !rotationValue ||
  !chunkGridToggle ||
  !interpolationToggle ||
  !hashingToggle ||
  !diagnosticsToggle ||
  !recordingNameInput ||
  !recordingStatus ||
  !replayStatus ||
  !replayModal ||
  !replayInput ||
  !replayError ||
  !replayLoadButton ||
  !replayCancelButton ||
  !exportModal ||
  !exportOutput ||
  !exportStatus ||
  !exportCopyButton ||
  !exportCloseButton
) {
  throw new Error("Expected app layout elements in index.html");
}

const DEFAULT_GRID_WIDTH = 128;
const DEFAULT_GRID_HEIGHT = 128;
const MIN_GRID_SIZE = 32;
const MAX_GRID_SIZE = 1024;
const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 32;
const ZOOM_STEP = 0.0015;
const CANVAS_FIT_PADDING_X = 32;
const CANVAS_FIT_PADDING_Y = 32;

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
let gravityMagnitude = DEFAULT_GRAVITY;
let rotationDegrees = DEFAULT_ROTATION_DEGREES;
let isChunkGridVisible = false;
let isInterpolationEnabled = false;
let isHashingEnabled = false;
let isDiagnosticsEnabled = false;
let hoveredCellX = -1;
let hoveredCellY = -1;
const recorder = createRecorderState();
type ControlChangeSource = "user" | "replay" | "load";
type ReplayMismatch = {
  actualHash: string | null;
  context: string;
  expectedHash: string;
  tick: number;
};
type ReplayState = {
  error: string | null;
  isCompleted: boolean;
  isDiverged: boolean;
  mismatch: ReplayMismatch | null;
  nextActionIndex: number;
  recording: SimulationRecording | null;
};
const replay: ReplayState = {
  error: null,
  isCompleted: false,
  isDiverged: false,
  mismatch: null,
  nextActionIndex: 0,
  recording: null,
};

const getRunInfo = () => inspectSimulationRun(animationBuffer);

const getRecordedHash = () => {
  const runInfo = getRunInfo();
  return runInfo.hashingEnabled && runInfo.stepCount > 0
    ? runInfo.currentTickHashHex
    : null;
};

const getCurrentStepInputs = () => ({
  diagnosticsEnabled: isDiagnosticsEnabled,
  gravityMagnitude,
  hashingEnabled: isHashingEnabled,
  rotationRadians: (rotationDegrees * Math.PI) / 180,
  tau,
});

const getLastRecordedAction = () => recorder.actions.at(-1) ?? null;
const getIsReplayLoaded = () => replay.recording !== null;
const getNextReplayAction = () => replay.recording?.actions[replay.nextActionIndex] ?? null;

const updateControlLocks = () => {
  const replayLoaded = getIsReplayLoaded();
  recordingToggleButton.disabled = replayLoaded;
  recordingExportButton.disabled =
    replayLoaded || recorder.isRecording || recorder.actions.length === 0;
  replayOpenButton.disabled = recorder.isRecording || replayLoaded;
  replayStopButton.disabled = !replayLoaded;
  simulationResetButton.disabled = recorder.isRecording || replayLoaded;
  gridWidthInput.disabled = recorder.isRecording || replayLoaded;
  gridHeightInput.disabled = recorder.isRecording || replayLoaded;
  tauSlider.disabled = replayLoaded;
  gravitySlider.disabled = replayLoaded;
  rotationSlider.disabled = replayLoaded;
  hashingToggle.disabled = replayLoaded;
  diagnosticsToggle.disabled = false;
  recordingNameInput.disabled = recorder.isRecording || replayLoaded;
};

const pushRecordedAction = (
  createAction: (tick: number, seq: number, hash: string | null) => RecordedSimulationAction,
) => {
  if (!recorder.isRecording) {
    return;
  }

  const runInfo = getRunInfo();
  const seq = nextRecordedActionPosition(recorder, runInfo.stepCount);
  appendOrCoalesceRecordedAction(
    recorder,
    createAction(runInfo.stepCount, seq, getRecordedHash()),
  );
  updateRecordingUi();
};

const setReplayModalOpen = (open: boolean) => {
  replayModal.classList.toggle("is-hidden", !open);
  replayModal.setAttribute("aria-hidden", String(!open));
  if (!open) {
    replayError.textContent = "";
    return;
  }

  replayInput.focus();
  replayInput.select();
};

const setExportModalOpen = (open: boolean) => {
  exportModal.classList.toggle("is-hidden", !open);
  exportModal.setAttribute("aria-hidden", String(!open));

  if (!open) {
    exportStatus.textContent = "";
    return;
  }

  exportOutput.focus();
  exportOutput.select();
};

const updateRecordingUi = () => {
  const recordingLabel = recordingToggleButton.querySelector<HTMLElement>(".side-button-label");

  if (recordingLabel) {
    recordingLabel.textContent = recorder.isRecording ? "Stop" : "Record";
  }
  updateControlLocks();

  const stateLabel = recorder.isRecording
    ? "recording"
    : recorder.actions.length > 0
    ? "stopped"
    : "idle";
  const currentRecordedTick = recorder.isRecording
    ? getRunInfo().stepCount
    : recorder.endTick ?? recorder.startTick ?? getLastRecordedAction()?.tick ?? null;
  const currentRecordedHash = recorder.isRecording
    ? getRecordedHash()
    : recorder.endHash ?? getLastRecordedAction()?.hash ?? null;

  recordingStatus.innerHTML = `
    <div><span class="recording-status-label">Recorder</span> ${stateLabel}</div>
    <div><span class="recording-status-label">Name</span> ${recorder.name ?? "unnamed"}</div>
    <div><span class="recording-status-label">Actions</span> ${recorder.actions.length}</div>
    <div><span class="recording-status-label">Tick</span> ${currentRecordedTick ?? "n/a"}</div>
    <div><span class="recording-status-label">Hash</span> ${currentRecordedHash ?? "n/a"}</div>
  `;
};

const updateReplayUi = () => {
  updateControlLocks();

  const stateLabel = !getIsReplayLoaded()
    ? "idle"
    : replay.isDiverged
    ? "diverged"
    : replay.isCompleted
    ? "completed"
    : "running";
  const visualState = replay.isDiverged
    ? "error"
    : replay.isCompleted && getIsReplayLoaded()
    ? "success"
    : "neutral";
  const currentTick = getIsReplayLoaded() ? getRunInfo().stepCount : null;
  const nextActionTick = getNextReplayAction()?.tick ?? "done";
  const mismatch = replay.mismatch;

  replayStatus.dataset.state = visualState;
  replayStatus.innerHTML = `
    <div><span class="replay-status-label">Replay</span> ${stateLabel}</div>
    <div><span class="replay-status-label">Name</span> ${replay.recording?.name ?? "n/a"}</div>
    <div><span class="replay-status-label">Actions</span> ${replay.recording?.actions.length ?? 0}</div>
    <div><span class="replay-status-label">Tick</span> ${currentTick ?? "n/a"}</div>
    <div><span class="replay-status-label">Next Tick</span> ${nextActionTick}</div>
    <div><span class="replay-status-label">End Hash</span> ${replay.recording?.endHash ?? "n/a"}</div>
    <div><span class="replay-status-label">Mismatch</span> ${
      mismatch ? `${mismatch.context} @ ${mismatch.tick}` : "none"
    }</div>
  `;
};

const updateAnimationToggleUi = () => {
  const animationLabel =
    animationToggleButton.querySelector<HTMLElement>(".side-button-label");

  animationToggleButton.dataset.state = isAnimationRunning ? "running" : "paused";

  if (animationLabel) {
    animationLabel.textContent = isAnimationRunning ? "Pause" : "Resume";
  }
};

const applyHashingEnabled = (nextValue: boolean, shouldRender: boolean) => {
  isHashingEnabled = nextValue;
  hashingToggle.checked = nextValue;

  if (shouldRender) {
    renderCurrentFrame(0);
  }
};

const applyTau = (
  nextValue: number,
  source: ControlChangeSource,
  shouldRender: boolean,
) => {
  tau = Math.max(MIN_TAU, Math.min(MAX_TAU, nextValue));
  tauSlider.value = String(tau);
  tauValue.textContent = formatTau(tau);

  if (source === "user") {
    pushRecordedAction((tick, seq, hash) => ({
      tick,
      seq,
      hash,
      type: "set_tau",
      value: tau,
    }));
  }

  if (shouldRender) {
    renderCurrentFrame(0);
  }
};

const applyGravity = (
  nextValue: number,
  source: ControlChangeSource,
  shouldRender: boolean,
) => {
  gravityMagnitude = Math.max(MIN_GRAVITY, Math.min(MAX_GRAVITY, nextValue));
  gravitySlider.value = String(gravityMagnitude);
  gravityValue.textContent = formatGravity(gravityMagnitude);

  if (source === "user") {
    pushRecordedAction((tick, seq, hash) => ({
      tick,
      seq,
      hash,
      type: "set_gravity",
      value: gravityMagnitude,
    }));
  }

  if (shouldRender) {
    renderCurrentFrame(0);
  }
};

const applyRotationDegrees = (
  nextValue: number,
  source: ControlChangeSource,
  shouldRender: boolean,
) => {
  rotationDegrees = Math.max(
    MIN_ROTATION_DEGREES,
    Math.min(MAX_ROTATION_DEGREES, nextValue),
  );
  rotationSlider.value = String(rotationDegrees);
  rotationValue.textContent = formatRotation(rotationDegrees);

  if (isCanvasAutoFit) {
    resetCanvasView();
  } else {
    renderCanvasTransform();
  }

  if (source === "user") {
    pushRecordedAction((tick, seq, hash) => ({
      tick,
      seq,
      hash,
      type: "set_rotation_degrees",
      value: rotationDegrees,
    }));
  }

  if (shouldRender) {
    renderCurrentFrame(0);
  }
};

const clearReplayState = () => {
  replay.error = null;
  replay.isCompleted = false;
  replay.isDiverged = false;
  replay.mismatch = null;
  replay.nextActionIndex = 0;
  replay.recording = null;
};

const setReplayMismatch = (
  tick: number,
  expectedHash: string,
  actualHash: string | null,
  context: string,
) => {
  if (replay.isDiverged) {
    return;
  }

  replay.isDiverged = true;
  replay.mismatch = {
    actualHash,
    context,
    expectedHash,
    tick,
  };
  isAnimationRunning = false;
  updateAnimationToggleUi();
};

const verifyReplayHash = (
  expectedHash: string | null,
  tick: number,
  context: string,
) => {
  if (!expectedHash) {
    return;
  }

  const actualHash = getRecordedHash();
  if (actualHash !== expectedHash) {
    setReplayMismatch(tick, expectedHash, actualHash, context);
  }
};

const applyReplayActionsForCurrentTick = () => {
  if (!replay.recording || replay.isCompleted || replay.isDiverged) {
    return;
  }

  const currentTick = getRunInfo().stepCount;
  while (true) {
    const action = getNextReplayAction();
    if (!action || action.tick !== currentTick) {
      break;
    }

    verifyReplayHash(action.hash, currentTick, action.type);
    if (replay.isDiverged) {
      break;
    }

    if (action.type === "set_tau") {
      applyTau(action.value, "replay", false);
    } else if (action.type === "set_gravity") {
      applyGravity(action.value, "replay", false);
    } else if (action.type === "set_rotation_degrees") {
      applyRotationDegrees(action.value, "replay", false);
    }

    replay.nextActionIndex += 1;
  }
};

const completeReplayIfNeeded = () => {
  if (!replay.recording || replay.isCompleted || replay.isDiverged) {
    return;
  }

  const currentTick = getRunInfo().stepCount;
  if (replay.recording.endTick !== null && currentTick >= replay.recording.endTick) {
    verifyReplayHash(replay.recording.endHash, replay.recording.endTick, "end_hash");
    replay.isCompleted = true;
    isAnimationRunning = false;
    updateAnimationToggleUi();
  }
};

const loadReplayRecording = (recording: SimulationRecording) => {
  clearReplayState();
  replay.recording = recording;

  const startAction = recording.actions[0];
  if (startAction.type !== "start_sim") {
    throw new Error("Expected start_sim as first replay action");
  }

  gridWidthInput.value = String(startAction.width);
  gridHeightInput.value = String(startAction.height);
  recreateFrameBuffer(startAction.width, startAction.height);
  resetSimulation();
  applyHashingEnabled(startAction.hashingEnabled, false);
  applyTau(startAction.tau, "load", false);
  applyGravity(startAction.gravityMagnitude, "load", false);
  applyRotationDegrees(startAction.rotationDegrees, "load", false);
  replay.nextActionIndex = 1;
  isCanvasAutoFit = true;
  resetCanvasView();
  renderCurrentFrame(0);
  isAnimationRunning = true;
  updateAnimationToggleUi();
  completeReplayIfNeeded();
  updateReplayUi();
  updateRecordingUi();
};

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

const formatFlag = (flag: number) => {
  switch (flag) {
    case 0:
      return "fluid";
    case 1:
      return "solid";
    case 2:
      return "empty";
    case 3:
      return "interface";
    default:
      return `unknown (${flag})`;
  }
};

const formatBoolean = (value: boolean) => (value ? "yes" : "no");

const renderDiagnosticsSummary = (info: CellDebugInfo | null) => {
  const diagnostics = info?.latestDiagnostics;
  const step = diagnostics?.step ?? 0;
  const hashHex = info?.currentTickHashHex ?? "0000000000000000";
  const diagnosticsEnabled = getRunInfo().diagnosticsEnabled;

  const phaseRows = diagnostics?.phases
    ? diagnostics.phases
    .map(
      (phase: PhaseDiagnostics) => `
        <tr>
          <td>${phase.phase}</td>
          <td>${phase.changedCells}</td>
          <td>${phase.fluidTouchingEmpty}</td>
          <td>${phase.interfaceWithoutFluid}</td>
          <td>${phase.interfaceWithoutEmpty}</td>
          <td>${phase.zebraCells}</td>
        </tr>
      `,
    )
    .join("")
    : "";

  return `
    <div class="inspector-section">
      <div class="inspector-section-title">Run</div>
      <div class="inspector-grid">
        <div class="inspector-label">Tick</div><div>${step}</div>
        <div class="inspector-label">Chain Hash</div><div class="inspector-hash">${hashHex}</div>
      </div>
    </div>
    <div class="inspector-section">
      <div class="inspector-section-title">Last Step #${step}</div>
      ${!diagnosticsEnabled
        ? `<div class="inspector-empty">Phase diagnostics are disabled.</div>`
        : diagnostics && diagnostics.phases.length > 0 ? `
      <table class="inspector-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th>Changed</th>
            <th>F-E</th>
            <th>I-noF</th>
            <th>I-noE</th>
            <th>Zebra</th>
          </tr>
        </thead>
        <tbody>${phaseRows}</tbody>
      </table>
      ` : `<div class="inspector-empty">No step diagnostics yet.</div>`}
    </div>
  `;
};

const updateInspector = () => {
  if (hoveredCellX < 0 || hoveredCellY < 0) {
    const info = inspectSimulationCell(animationBuffer, 0, 0);
    inspectorBody.innerHTML = `
      ${renderDiagnosticsSummary(info)}
      <div class="inspector-empty">Hover the simulation to inspect a cell.</div>
    `;
    return;
  }

  const info = inspectSimulationCell(animationBuffer, hoveredCellX, hoveredCellY);

  if (info === null) {
    const fallbackInfo = inspectSimulationCell(animationBuffer, 0, 0);
    inspectorBody.innerHTML = `
      ${renderDiagnosticsSummary(fallbackInfo)}
      <div class="inspector-empty">Pointer is outside the simulation domain.</div>
    `;
    return;
  }

  inspectorBody.innerHTML = `
    ${renderDiagnosticsSummary(info)}
    <div class="inspector-section">
      <div class="inspector-section-title">Cell</div>
      <div class="inspector-grid">
        <div class="inspector-label">Cell</div><div>${info.x}, ${info.y}</div>
        <div class="inspector-label">Type</div><div>${formatFlag(info.flag)}</div>
        <div class="inspector-label">Fill</div><div>${info.fill.toFixed(3)}</div>
        <div class="inspector-label">Mass</div><div>${info.mass.toFixed(4)}</div>
        <div class="inspector-label">Rho</div><div>${info.rho.toFixed(4)}</div>
        <div class="inspector-label">Ux</div><div>${info.ux.toFixed(5)}</div>
        <div class="inspector-label">Uy</div><div>${info.uy.toFixed(5)}</div>
        <div class="inspector-label">Speed</div><div>${info.speed.toFixed(5)}</div>
        <div class="inspector-label">Nx</div><div>${info.normalX.toFixed(4)}</div>
        <div class="inspector-label">Ny</div><div>${info.normalY.toFixed(4)}</div>
      </div>
    </div>
    <div class="inspector-section">
      <div class="inspector-section-title">Topology</div>
      <div class="inspector-grid">
        <div class="inspector-label">Touches Empty</div><div>${formatBoolean(info.touchesEmpty)}</div>
        <div class="inspector-label">Touches Fluid</div><div>${formatBoolean(info.touchesFluid)}</div>
        <div class="inspector-label">Touches Interface</div><div>${formatBoolean(info.touchesInterface)}</div>
        <div class="inspector-label">Touches Solid</div><div>${formatBoolean(info.touchesSolid)}</div>
        <div class="inspector-label">Liquid Neighbors</div><div>${info.liquidNeighborCount}</div>
        <div class="inspector-label">Alternating Nbrs</div><div>${info.alternatingNeighborCount}</div>
        <div class="inspector-label">I Without Fluid</div><div>${formatBoolean(info.interfaceWithoutFluid)}</div>
        <div class="inspector-label">I Without Empty</div><div>${formatBoolean(info.interfaceWithoutEmpty)}</div>
        <div class="inspector-label">Zebra Candidate</div><div>${formatBoolean(info.zebraCandidate)}</div>
      </div>
    </div>
  `;
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
  animate(animationBuffer, dt, {
    afterFixedStep: () => {
      completeReplayIfNeeded();
    },
    beforeFixedStep: () => {
      if (replay.isCompleted || replay.isDiverged) {
        return false;
      }
      applyReplayActionsForCurrentTick();
      return replay.isCompleted || replay.isDiverged ? false : getCurrentStepInputs();
    },
    diagnosticsEnabled: isDiagnosticsEnabled,
    gravityMagnitude,
    hashingEnabled: isHashingEnabled,
    interpolationEnabled: isInterpolationEnabled,
    rotationRadians: (rotationDegrees * Math.PI) / 180,
    tau,
    visualizationMode,
  });
  presentPixels();

  if (isChunkGridVisible) {
    renderChunkGrid();
  }

  updateInspector();
  updateRecordingUi();
  updateReplayUi();
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

const stepCurrentFrame = () => {
  applyReplayActionsForCurrentTick();
  if (replay.isCompleted || replay.isDiverged) {
    renderCurrentFrame(0);
    return;
  }
  stepAnimation(animationBuffer, {
    afterFixedStep: () => {
      completeReplayIfNeeded();
    },
    beforeFixedStep: () =>
      replay.isCompleted || replay.isDiverged ? false : getCurrentStepInputs(),
    diagnosticsEnabled: isDiagnosticsEnabled,
    gravityMagnitude,
    hashingEnabled: isHashingEnabled,
    interpolationEnabled: isInterpolationEnabled,
    rotationRadians: (rotationDegrees * Math.PI) / 180,
    tau,
    visualizationMode,
  });
  presentPixels();

  if (isChunkGridVisible) {
    renderChunkGrid();
  }

  updateInspector();
  updateRecordingUi();
  updateReplayUi();
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

const getViewRotationRadians = () => {
  return (rotationDegrees * Math.PI) / 180;
};

const getRotatedCanvasBounds = (scale: number) => {
  const angle = getViewRotationRadians();
  const absCos = Math.abs(Math.cos(angle));
  const absSin = Math.abs(Math.sin(angle));
  const scaledWidth = gridWidth * scale;
  const scaledHeight = gridHeight * scale;

  return {
    height: scaledWidth * absSin + scaledHeight * absCos,
    width: scaledWidth * absCos + scaledHeight * absSin,
  };
};

const getTransformedCanvasMetrics = (scale: number) => {
  const angle = getViewRotationRadians();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centerX = gridWidth * 0.5;
  const centerY = gridHeight * 0.5;
  const corners = [
    { x: 0, y: 0 },
    { x: gridWidth, y: 0 },
    { x: 0, y: gridHeight },
    { x: gridWidth, y: gridHeight },
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const localX = (corner.x - centerX) * scale;
    const localY = (corner.y - centerY) * scale;
    const rotatedX = localX * cos - localY * sin + centerX;
    const rotatedY = localX * sin + localY * cos + centerY;

    minX = Math.min(minX, rotatedX);
    minY = Math.min(minY, rotatedY);
    maxX = Math.max(maxX, rotatedX);
    maxY = Math.max(maxY, rotatedY);
  }

  return {
    height: maxY - minY,
    minX,
    minY,
    width: maxX - minX,
  };
};

const getGridCoordinatesFromWorkspacePoint = (workspaceX: number, workspaceY: number) => {
  const centerX = gridWidth * 0.5;
  const centerY = gridHeight * 0.5;
  const angle = getViewRotationRadians();
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const translatedX = workspaceX - canvasOffsetX - centerX;
  const translatedY = workspaceY - canvasOffsetY - centerY;
  const unrotatedX = translatedX * cos + translatedY * sin;
  const unrotatedY = -translatedX * sin + translatedY * cos;
  const gridX = centerX + unrotatedX / canvasScale;
  const gridY = centerY + unrotatedY / canvasScale;

  return {
    x: Math.floor(gridX),
    y: Math.floor(gridY),
  };
};

const renderCanvasTransform = () => {
  const centerX = gridWidth * 0.5;
  const centerY = gridHeight * 0.5;
  canvasStage.style.transform =
    `translate(${canvasOffsetX}px, ${canvasOffsetY}px) ` +
    `translate(${centerX}px, ${centerY}px) ` +
    `rotate(${rotationDegrees}deg) ` +
    `scale(${canvasScale}) ` +
    `translate(${-centerX}px, ${-centerY}px)`;
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
  const transformedMetrics = getTransformedCanvasMetrics(scale);
  const x = (workspaceView.clientWidth - transformedMetrics.width) * 0.5 - transformedMetrics.minX;
  const y = (workspaceView.clientHeight - transformedMetrics.height) * 0.5 - transformedMetrics.minY;
  setCanvasTransform(x, y, scale);
};

const getCanvasFitScale = () => {
  const availableWidth = Math.max(
    workspaceView.clientWidth - CANVAS_FIT_PADDING_X * 2,
    0,
  );
  const availableHeight = Math.max(
    workspaceView.clientHeight - CANVAS_FIT_PADDING_Y * 2,
    0,
  );

  if (availableWidth <= 0 || availableHeight <= 0) {
    return MIN_CANVAS_SCALE;
  }

  const rotatedBounds = getRotatedCanvasBounds(1);
  const fitScale = Math.min(
    availableWidth / rotatedBounds.width,
    availableHeight / rotatedBounds.height,
  );

  return clampCanvasScale(fitScale);
};

const resetCanvasView = () => {
  isCanvasAutoFit = true;
  centerCanvasInWorkspace(getCanvasFitScale());
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
  updateAnimationToggleUi();
});

recordingToggleButton.addEventListener("click", () => {
  if (recorder.isRecording) {
    recorder.isRecording = false;
    recorder.endTick = getRunInfo().stepCount;
    recorder.endHash = getRecordedHash();
    updateRecordingUi();
    return;
  }

  const name = recordingNameInput.value.trim();
  recorder.actions = [];
  recorder.endHash = null;
  recorder.endTick = null;
  recorder.isRecording = true;
  recorder.name = name.length > 0 ? name : null;
  recorder.lastActionTick = null;
  recorder.nextSeq = 0;

  const runInfo = getRunInfo();
  recorder.startTick = runInfo.stepCount;
  const seq = nextRecordedActionPosition(recorder, runInfo.stepCount);
  appendOrCoalesceRecordedAction(recorder, {
    tick: runInfo.stepCount,
    seq,
    hash: getRecordedHash(),
    type: "start_sim",
    name: recorder.name,
    width: gridWidth,
    height: gridHeight,
    tau,
    gravityMagnitude,
    rotationDegrees,
    hashingEnabled: isHashingEnabled,
  });
  updateRecordingUi();
});

recordingExportButton.addEventListener("click", () => {
  exportStatus.textContent = "";
  exportOutput.value = JSON.stringify(buildRecording(recorder), null, 2);
  setExportModalOpen(true);
});

replayOpenButton.addEventListener("click", () => {
  replayError.textContent = "";
  replayInput.value = "";
  setReplayModalOpen(true);
});

replayCancelButton.addEventListener("click", () => {
  setReplayModalOpen(false);
});

replayLoadButton.addEventListener("click", () => {
  const parsed = parseSimulationRecording(replayInput.value);
  if (!parsed.recording) {
    replayError.textContent = parsed.error;
    return;
  }

  setReplayModalOpen(false);
  loadReplayRecording(parsed.recording);
});

replayStopButton.addEventListener("click", () => {
  clearReplayState();
  updateReplayUi();
  updateRecordingUi();
});

exportCloseButton.addEventListener("click", () => {
  setExportModalOpen(false);
});

exportCopyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportOutput.value);
    exportStatus.textContent = "Copied";
  } catch {
    exportStatus.textContent = "Clipboard copy failed";
  }
});

simulationStepButton.addEventListener("click", () => {
  if (isAnimationRunning) {
    isAnimationRunning = false;
    updateAnimationToggleUi();
  }

  stepCurrentFrame();
});

simulationResetButton.addEventListener("click", () => {
  applyPendingGridSize();
});

viewResetButton.addEventListener("click", () => {
  resetCanvasView();
});

visualizationModeSelect.addEventListener("change", () => {
  const nextMode = visualizationModeSelect.value;

  if (nextMode === "speed" || nextMode === "density" || nextMode === "debug") {
    visualizationMode = nextMode;
    renderCurrentFrame(0);
  }
});

const formatTau = (value: number) => value.toFixed(2);
const formatGravity = (value: number) => value.toFixed(5);
const formatRotation = (value: number) => `${Math.round(value)}°`;

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

  applyTau(nextTau, "user", true);
});

gravitySlider.min = String(MIN_GRAVITY);
gravitySlider.max = String(MAX_GRAVITY);
gravitySlider.step = "0.00001";
gravitySlider.value = String(DEFAULT_GRAVITY);
gravityValue.textContent = formatGravity(DEFAULT_GRAVITY);

gravitySlider.addEventListener("input", () => {
  const nextGravity = Number.parseFloat(gravitySlider.value);

  if (!Number.isFinite(nextGravity)) {
    return;
  }

  applyGravity(nextGravity, "user", true);
});

rotationSlider.min = String(MIN_ROTATION_DEGREES);
rotationSlider.max = String(MAX_ROTATION_DEGREES);
rotationSlider.step = "1";
rotationSlider.value = String(DEFAULT_ROTATION_DEGREES);
rotationValue.textContent = formatRotation(DEFAULT_ROTATION_DEGREES);

rotationSlider.addEventListener("input", () => {
  const nextRotation = Number.parseFloat(rotationSlider.value);

  if (!Number.isFinite(nextRotation)) {
    return;
  }

  applyRotationDegrees(nextRotation, "user", true);
});

chunkGridToggle.addEventListener("change", () => {
  isChunkGridVisible = chunkGridToggle.checked;
  renderCurrentFrame(0);
});

interpolationToggle.addEventListener("change", () => {
  isInterpolationEnabled = interpolationToggle.checked;
  renderCurrentFrame(0);
});

hashingToggle.addEventListener("change", () => {
  applyHashingEnabled(hashingToggle.checked, true);
});

diagnosticsToggle.addEventListener("change", () => {
  isDiagnosticsEnabled = diagnosticsToggle.checked;
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

workspaceView.addEventListener("pointermove", (event) => {
  const rect = workspaceView.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const gridCoordinates = getGridCoordinatesFromWorkspacePoint(localX, localY);
  hoveredCellX = gridCoordinates.x;
  hoveredCellY = gridCoordinates.y;
  updateInspector();
});

workspaceView.addEventListener("pointerleave", () => {
  hoveredCellX = -1;
  hoveredCellY = -1;
  updateInspector();
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
updateInspector();
updateRecordingUi();
updateReplayUi();
updateAnimationToggleUi();
renderCurrentFrame(0);
requestAnimationFrame(frame);
