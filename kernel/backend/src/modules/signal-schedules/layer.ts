import { Layer } from "effect";

import { ChangeSetsLive } from "#modules/changes/layer";
import { RyotQLService } from "#modules/ryotql/service";

import { SignalScheduleRepository } from "./repository";
import { SignalScheduleWorker } from "./worker";

export const SignalScheduleWorkerLive = SignalScheduleWorker.layer.pipe(
	Layer.provide(
		Layer.mergeAll(SignalScheduleRepository.layer, RyotQLService.layer, ChangeSetsLive),
	),
);
