import { Effect, Layer } from "effect";

import { LifecycleServicesLive, SignalEmissionServiceLive } from "#modules/automations/layer";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepositoryLive } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { NotificationSourcePolicy } from "#modules/notifications/source-policy";
import { PluginRepositoryLive } from "#modules/plugins/packages/repository-layer";

import { RemindersRepository } from "./repository";
import { RemindersService } from "./service";
import { ReminderWorker } from "./worker";

const repositories = Layer.mergeAll(
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
	RemindersRepository.layer,
	MutationReceipts.layer,
	EntitiesRepositoryLive,
	EntityUserDataGraphRepository.layer,
	NotificationDeliveryRepository.layer,
	PluginRepositoryLive,
	DefinitionRepository.layer,
);

export const RemindersServiceLive = RemindersService.layer.pipe(Layer.provide(repositories));

export const ReminderWorkerLive = ReminderWorker.layer.pipe(
	Layer.provide(Layer.mergeAll(repositories, LifecycleServicesLive, SignalEmissionServiceLive)),
);

export const ReminderNotificationSourcePolicyLive = Layer.effect(
	NotificationSourcePolicy,
	Effect.gen(function* () {
		const repository = yield* RemindersRepository;
		return { authorize: repository.authorizeRun };
	}),
).pipe(Layer.provide(RemindersRepository.layer));
