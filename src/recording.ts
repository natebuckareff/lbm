export type RecordedSimulationAction =
  | {
      tick: number;
      seq: number;
      hash: string | null;
      type: "start_sim";
      name: string | null;
      width: number;
      height: number;
      tau: number;
      gravityMagnitude: number;
      rotationDegrees: number;
      hashingEnabled: boolean;
    }
  | {
      tick: number;
      seq: number;
      hash: string | null;
      type: "set_tau";
      value: number;
    }
  | {
      tick: number;
      seq: number;
      hash: string | null;
      type: "set_gravity";
      value: number;
    }
  | {
      tick: number;
      seq: number;
      hash: string | null;
      type: "set_rotation_degrees";
      value: number;
    };

export type SimulationRecording = {
  version: 1;
  endHash: string | null;
  name: string | null;
  endTick: number | null;
  startTick: number | null;
  actions: RecordedSimulationAction[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

const isRecordedSimulationAction = (
  value: unknown,
): value is RecordedSimulationAction => {
  if (!isPlainObject(value) || !isNumber(value.tick) || !isNumber(value.seq)) {
    return false;
  }

  if (!isNullableString(value.hash) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "start_sim":
      return (
        isNullableString(value.name) &&
        isNumber(value.width) &&
        isNumber(value.height) &&
        isNumber(value.tau) &&
        isNumber(value.gravityMagnitude) &&
        isNumber(value.rotationDegrees) &&
        typeof value.hashingEnabled === "boolean"
      );
    case "set_tau":
    case "set_gravity":
    case "set_rotation_degrees":
      return isNumber(value.value);
    default:
      return false;
  }
};

export const parseSimulationRecording = (json: string) => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      error: "Recording JSON could not be parsed.",
      recording: null,
    } as const;
  }

  if (!isPlainObject(parsed)) {
    return {
      error: "Recording must be a JSON object.",
      recording: null,
    } as const;
  }

  if (parsed.version !== 1) {
    return {
      error: "Recording version must be 1.",
      recording: null,
    } as const;
  }

  if (
    !isNullableString(parsed.name) ||
    !isNullableNumber(parsed.startTick) ||
    !isNullableNumber(parsed.endTick) ||
    !isNullableString(parsed.endHash) ||
    !Array.isArray(parsed.actions)
  ) {
    return {
      error: "Recording metadata is malformed.",
      recording: null,
    } as const;
  }

  const actions = parsed.actions;
  if (actions.length === 0) {
    return {
      error: "Recording must contain at least one action.",
      recording: null,
    } as const;
  }

  if (!actions.every(isRecordedSimulationAction)) {
    return {
      error: "Recording contains an invalid action.",
      recording: null,
    } as const;
  }

  const firstAction = actions[0];
  if (firstAction.type !== "start_sim") {
    return {
      error: "Recording must start with a start_sim action.",
      recording: null,
    } as const;
  }

  if (parsed.startTick !== 0 || firstAction.tick !== 0) {
    return {
      error: "Replay currently requires recordings that start at tick 0.",
      recording: null,
    } as const;
  }

  if (parsed.endTick !== null && parsed.endTick < parsed.startTick) {
    return {
      error: "Recording endTick must be greater than or equal to startTick.",
      recording: null,
    } as const;
  }

  let previousTick = -1;
  let previousSeq = -1;
  for (const action of actions) {
    if (action.tick < previousTick) {
      return {
        error: "Recording actions must be sorted by nondecreasing tick.",
        recording: null,
      } as const;
    }

    if (action.tick === previousTick && action.seq < previousSeq) {
      return {
        error: "Recording actions with the same tick must be sorted by seq.",
        recording: null,
      } as const;
    }

    previousTick = action.tick;
    previousSeq = action.seq;
  }

  return {
    error: null,
    recording: parsed as SimulationRecording,
  } as const;
};

export type RecorderState = {
  actions: RecordedSimulationAction[];
  endHash: string | null;
  endTick: number | null;
  isRecording: boolean;
  lastActionTick: number | null;
  name: string | null;
  nextSeq: number;
  startTick: number | null;
};

export const createRecorderState = (): RecorderState => ({
  actions: [],
  endHash: null,
  endTick: null,
  isRecording: false,
  lastActionTick: null,
  name: null,
  nextSeq: 0,
  startTick: null,
});

export const nextRecordedActionPosition = (
  recorder: RecorderState,
  tick: number,
) => {
  if (recorder.lastActionTick === tick) {
    const seq = recorder.nextSeq;
    recorder.nextSeq += 1;
    return seq;
  }

  recorder.lastActionTick = tick;
  recorder.nextSeq = 1;
  return 0;
};

const canCoalesceActionType = (
  type: RecordedSimulationAction["type"],
) => type !== "start_sim";

export const appendOrCoalesceRecordedAction = (
  recorder: RecorderState,
  action: RecordedSimulationAction,
) => {
  const previous = recorder.actions.at(-1);

  if (
    previous &&
    canCoalesceActionType(previous.type) &&
    previous.tick === action.tick &&
    previous.type === action.type
  ) {
    recorder.actions[recorder.actions.length - 1] = {
      ...action,
      seq: previous.seq,
    };
    return;
  }

  recorder.actions.push(action);
};

export const buildRecording = (
  recorder: RecorderState,
): SimulationRecording => ({
  version: 1,
  endHash: recorder.endHash,
  name: recorder.name,
  endTick: recorder.endTick,
  startTick: recorder.startTick,
  actions: recorder.actions,
});
