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
