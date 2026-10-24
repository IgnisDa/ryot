import { Layer } from "effect";

import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { MutationReceipts } from "#modules/mutations/receipts";
import { RyotQLService } from "#modules/ryotql/service";

import { CalendarDeliveryRepository } from "./delivery-repository";
import { CalendarDeliveryWorker } from "./delivery-worker";
import { CalendarSourcesRepository } from "./repository";
import { CalendarSourcesService } from "./service";

export const CalendarSourcesServiceLive = CalendarSourcesService.layer.pipe(
	Layer.provide(CalendarSourcesRepository.layer),
);

export const CalendarDeliveryWorkerLive = CalendarDeliveryWorker.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			CalendarDeliveryRepository.layer,
			MutationReceipts.layer,
			RyotQLService.layer,
			LifecycleServicesLive,
			SignalEmissionServiceLive,
		),
	),
);
