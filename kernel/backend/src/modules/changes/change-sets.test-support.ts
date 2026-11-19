import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { SignalEmissionService } from "#modules/automations/signal-service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { FoldMarks } from "#modules/derived-values/marks";
import { Folds } from "#modules/derived-values/service";
import { unfoldedFolds } from "#modules/derived-values/test-support";
import { EntitiesService } from "#modules/entities/service";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventMutations } from "#modules/events/mutations";
import { NotificationAdmissions } from "#modules/notifications/admission";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { NotificationSourcePolicy } from "#modules/notifications/source-policy";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { JobQueue } from "#platform/jobs/queue";

import { eventCreateChanges } from "./changes";
import { toCreateEventsResponse } from "./outcomes";
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

/** `ChangeSets` that writes only events over the caller's event services; other parts are absent. */
export const eventChangeSets = (folds: Folds["Service"] = unfoldedFolds) =>
	Layer.build(
		Layer.mergeAll(
			Layer.mock(EntitiesService)({}),
			Layer.mock(EntityUserDataService)({}),
			Layer.mock(RelationshipsService)({}),
			Layer.mock(PluginUserSettingsWriter)({}),
			Layer.mock(SignalEmissionService)({}),
			Layer.mock(NotificationsService)({}),
			Layer.mock(FoldMarks)({}),
			Layer.mock(SandboxRepository)({}),
		),
	).pipe(
		Effect.flatMap((absent) =>
			ChangeSets.make.pipe(
				Effect.provideServiceEffect(
					EventMutations,
					EventMutations.make.pipe(Effect.provideService(Folds, folds)),
				),
				Effect.provideContext(absent),
			),
		),
		Effect.scoped,
	);

/**
 * Independent event creates of existing entities, answered like the HTTP create endpoint. Given
 * identities are kept verbatim.
 */
export const createEvents = (input: {
	readonly userId: UserId;
	readonly command: DomainLifecycleCommand;
	readonly itemIdentities?: ReadonlyArray<string>;
	readonly payload: ReadonlyArray<CreateEventItem>;
}) =>
	Effect.flatMap(ChangeSets, (changes) =>
		changes.commit(
			eventCreateChanges(input.userId, input.payload, input.itemIdentities),
			input.command,
			{
				events:
					input.itemIdentities === undefined
						? { independent: true }
						: { independent: true, verbatimIdentities: true },
			},
		),
	).pipe(Effect.map((result) => toCreateEventsResponse(result.outcomes)));
