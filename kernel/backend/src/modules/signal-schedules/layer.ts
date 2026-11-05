import { Layer } from "effect";

import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { RyotQLService } from "#modules/ryotql/service";

import { SignalScheduleRepository } from "./repository";
import { SignalScheduleWorker } from "./worker";

export const SignalScheduleWorkerLive = SignalScheduleWorker.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			SignalScheduleRepository.layer,
			RyotQLService.layer,
			LifecycleServicesLive,
			SignalEmissionServiceLive,
		),
	),
);
