import {
  CELL_EMPTY,
  CELL_FLUID,
  CELL_INTERFACE,
  CELL_SOLID,
  type SimulationState,
} from "./types";

export type VisualizationMode = "debug" | "density" | "speed";

export type RenderOptions = {
  interpolationAlpha: number;
  interpolationEnabled: boolean;
};

const clampChannel = (value: number) => {
  if (value <= 0) {
    return 0;
  }

  if (value >= 255) {
    return 255;
  }

  return value;
};

const lerp = (start: number, end: number, amount: number) => {
  return start + (end - start) * amount;
};

const blendColor = (
  base: { red: number; green: number; blue: number },
  target: { red: number; green: number; blue: number },
  amount: number,
) => {
  return {
    blue: lerp(base.blue, target.blue, amount),
    green: lerp(base.green, target.green, amount),
    red: lerp(base.red, target.red, amount),
  };
};

const AIR_COLOR = {
  blue: 232,
  green: 214,
  red: 186,
};

const LIQUID_COLOR = {
  blue: 178,
  green: 124,
  red: 38,
};

const WALL_COLOR = {
  blue: 80,
  green: 74,
  red: 68,
};

const DEBUG_INTERFACE_LOW = {
  blue: 255,
  green: 255,
  red: 255,
};

const DEBUG_INTERFACE_HIGH = {
  blue: 56,
  green: 172,
  red: 255,
};

const sampleSpeedPalette = (normalizedSpeed: number) => {
  const t = Math.max(0, Math.min(1, normalizedSpeed));
  const stops = [
    { at: 0, color: { red: 34, green: 58, blue: 112 } },
    { at: 0.18, color: { red: 52, green: 156, blue: 196 } },
    { at: 0.4, color: { red: 244, green: 211, blue: 94 } },
    { at: 0.7, color: { red: 231, green: 108, blue: 49 } },
    { at: 1, color: { red: 160, green: 36, blue: 36 } },
  ];

  for (let index = 1; index < stops.length; index += 1) {
    const left = stops[index - 1];
    const right = stops[index];

    if (t <= right.at) {
      const localT = (t - left.at) / Math.max(right.at - left.at, 1e-6);
      return {
        blue: lerp(left.color.blue, right.color.blue, localT),
        green: lerp(left.color.green, right.color.green, localT),
        red: lerp(left.color.red, right.color.red, localT),
      };
    }
  }

  return stops[stops.length - 1].color;
};

const sampleDensityPalette = (normalizedDensity: number) => {
  const t = Math.max(0, Math.min(1, normalizedDensity));
  const stops = [
    { at: 0, color: { red: 94, green: 54, blue: 24 } },
    { at: 0.4, color: { red: 168, green: 102, blue: 37 } },
    { at: 0.7, color: { red: 222, green: 160, blue: 58 } },
    { at: 1, color: { red: 252, green: 228, blue: 142 } },
  ];

  for (let index = 1; index < stops.length; index += 1) {
    const left = stops[index - 1];
    const right = stops[index];

    if (t <= right.at) {
      const localT = (t - left.at) / Math.max(right.at - left.at, 1e-6);
      return {
        blue: lerp(left.color.blue, right.color.blue, localT),
        green: lerp(left.color.green, right.color.green, localT),
        red: lerp(left.color.red, right.color.red, localT),
      };
    }
  }

  return stops[stops.length - 1].color;
};

const remapSpeedNormalized = (speed: number) => {
  const normalized = Math.max(0, Math.min(1, speed / 0.18));
  return Math.pow(normalized, 0.78);
};

export const renderState = (
  state: SimulationState,
  pixels: Uint8ClampedArray,
  mode: VisualizationMode,
  options: RenderOptions,
) => {
  const {
    fill,
    flags,
    previousFill,
    previousUx,
    previousUy,
    ux,
    uy,
  } = state.domain.fields;
  const alpha = Math.max(0, Math.min(1, options.interpolationAlpha));

  for (let cellIndex = 0; cellIndex < flags.length; cellIndex += 1) {
    const pixelBase = cellIndex * 4;
    const flag = flags[cellIndex];

    if (flag === CELL_SOLID) {
      pixels[pixelBase] = WALL_COLOR.red;
      pixels[pixelBase + 1] = WALL_COLOR.green;
      pixels[pixelBase + 2] = WALL_COLOR.blue;
      pixels[pixelBase + 3] = 255;
      continue;
    }

    if (flag === CELL_EMPTY) {
      pixels[pixelBase] = AIR_COLOR.red;
      pixels[pixelBase + 1] = AIR_COLOR.green;
      pixels[pixelBase + 2] = AIR_COLOR.blue;
      pixels[pixelBase + 3] = 255;
      continue;
    }

    const currentFill = flag === CELL_FLUID ? 1 : Math.max(0, Math.min(1, fill[cellIndex]));
    const interpolatedFill = options.interpolationEnabled
      ? Math.max(
        0,
        Math.min(1, lerp(previousFill[cellIndex], currentFill, alpha)),
      )
      : currentFill;

    if (mode === "debug") {
      if (flag === CELL_FLUID) {
        pixels[pixelBase] = 14;
        pixels[pixelBase + 1] = 92;
        pixels[pixelBase + 2] = 214;
        pixels[pixelBase + 3] = 255;
        continue;
      }

      const color = blendColor(DEBUG_INTERFACE_LOW, DEBUG_INTERFACE_HIGH, interpolatedFill);
      pixels[pixelBase] = clampChannel(color.red);
      pixels[pixelBase + 1] = clampChannel(color.green);
      pixels[pixelBase + 2] = clampChannel(color.blue);
      pixels[pixelBase + 3] = 255;
      continue;
    }

    const velocityX = options.interpolationEnabled
      ? lerp(previousUx[cellIndex], ux[cellIndex], alpha)
      : ux[cellIndex];
    const velocityY = options.interpolationEnabled
      ? lerp(previousUy[cellIndex], uy[cellIndex], alpha)
      : uy[cellIndex];

    if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) {
      pixels[pixelBase] = 255;
      pixels[pixelBase + 1] = 0;
      pixels[pixelBase + 2] = 255;
      pixels[pixelBase + 3] = 255;
      continue;
    }

    const color = mode === "density"
      ? sampleDensityPalette(Math.max(0, Math.min(1, (state.domain.fields.rho[cellIndex] - 0.94) / 0.12)))
      : sampleSpeedPalette(remapSpeedNormalized(Math.sqrt(velocityX * velocityX + velocityY * velocityY)));
    const mixed = blendColor(AIR_COLOR, color, interpolatedFill);

    pixels[pixelBase] = clampChannel(mixed.red);
    pixels[pixelBase + 1] = clampChannel(mixed.green);
    pixels[pixelBase + 2] = clampChannel(mixed.blue);
    pixels[pixelBase + 3] = 255;
  }
};
