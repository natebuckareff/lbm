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
  name: string | null;
  actions: RecordedSimulationAction[];
};

export type RecorderState = {
  actions: RecordedSimulationAction[];
  isRecording: boolean;
  lastActionTick: number | null;
  name: string | null;
  nextSeq: number;
};

export const createRecorderState = (): RecorderState => ({
  actions: [],
  isRecording: false,
  lastActionTick: null,
  name: null,
  nextSeq: 0,
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
  name: recorder.name,
  actions: recorder.actions,
});
