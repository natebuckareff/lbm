export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
