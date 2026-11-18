import { Effect, Layer } from "effect";

import { SignalEmissionService } from "#modules/automations/signal-service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { FoldMarks } from "#modules/derived-values/marks";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { NotificationAdmissions } from "#modules/notifications/admission";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { NotificationSourcePolicy } from "#modules/notifications/source-policy";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { JobQueue } from "#platform/jobs/queue";

import { ChangeSets } from "./service";

/** `ChangeSets` over the caller's database layer; the source policy admits or refuses every notification. */
export const changeSetsLayerWithNotificationSources = (authorized: boolean) =>
	ChangeSets.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				EntityUserDataService.layer.pipe(Layer.provideMerge(EntityUserDataGraphRepository.layer)),
				SignalEmissionService.layer.pipe(Layer.provideMerge(AutomationTriggerRepository.layer)),
				NotificationsService.layer.pipe(
					Layer.provideMerge(NotificationAdmissions.layer),
					Layer.provideMerge(
						Layer.mergeAll(
							NotificationsRepository.layer,
							NotificationDeliveryRepository.layer,
							Layer.succeed(NotificationSourcePolicy, {
								authorize: () => Effect.succeed(authorized),
							}),
						),
					),
				),
				FoldMarks.layer,
				SandboxRepository.layer,
			),
		),
		Layer.provideMerge(JobQueue.layer),
	);

export const changeSetsTestLayer = changeSetsLayerWithNotificationSources(true);
