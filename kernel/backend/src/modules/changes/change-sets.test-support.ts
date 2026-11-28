import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { EventUpdate } from "@ryot-app/contract/modules/events/mutations";
import type {
	CreateEventItem,
	EventWritePrecondition,
} from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
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

import { type EventChange, eventChanges, eventCreateChanges } from "./changes";
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

const partialChangeSets = (
	present: {
		readonly entities?: Layer.Layer<EntitiesService>;
		readonly signals?: Layer.Layer<SignalEmissionService>;
		readonly userData?: Layer.Layer<EntityUserDataService>;
	},
	folds: Folds["Service"],
) =>
	Layer.build(
		Layer.mergeAll(
			present.userData ?? Layer.mock(EntityUserDataService)({}),
			present.entities ?? Layer.mock(EntitiesService)({}),
			Layer.mock(RelationshipsService)({}),
			Layer.mock(PluginUserSettingsWriter)({}),
			present.signals ?? Layer.mock(SignalEmissionService)({}),
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

/** `ChangeSets` that writes only events over the caller's event services; other parts are absent. */
export const eventChangeSets = (folds: Folds["Service"] = unfoldedFolds) =>
	partialChangeSets({}, folds);

/** `ChangeSets` that writes entities and events over the caller's entity and event services. */
export const entityChangeSets = (folds: Folds["Service"] = unfoldedFolds) =>
	Effect.flatMap(EntitiesService, (entities) =>
		partialChangeSets({ entities: Layer.succeed(EntitiesService, entities) }, folds),
	);

/**
 * `ChangeSets` that writes events, entity data clears and merges, and signals over the caller's event,
 * `EntityUserDataService` and `SignalEmissionService` services; other parts are absent.
 */
export const userDataChangeSets = (folds: Folds["Service"] = unfoldedFolds) =>
	Effect.gen(function* () {
		const userData = yield* EntityUserDataService;
		const signals = yield* SignalEmissionService;
		return yield* partialChangeSets(
			{
				signals: Layer.succeed(SignalEmissionService, signals),
				userData: Layer.succeed(EntityUserDataService, userData),
			},
			folds,
		);
	});

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

/** An update of the loaded `entity` under its own schema, expecting it unchanged since it was loaded. */
export const entityUpdate = (entity: ListedEntity, name: string, properties: unknown) => ({
	name,
	properties,
	entitySchema: {
		slug: entity.entitySchemaSlug,
		owner: definitionOwner(entity.entitySchemaPluginId),
	},
	target: {
		entityId: entity.id,
		kind: "update" as const,
		expected: { name: entity.name, updatedAt: entity.updatedAt, properties: entity.properties },
	},
});

export const eventUpdate = (item: EventUpdate["item"]): EventChange => ({
	item,
	kind: "update",
	itemIdentity: `event:${item.eventId}`,
});

export const eventDelete = (eventId: EventId, expected?: EventWritePrecondition): EventChange => ({
	eventId,
	kind: "delete",
	itemIdentity: `event:${eventId}`,
	...(expected === undefined ? {} : { expected }),
});

/** Event updates and deletes committed together by a kernel writer, answering the written event IDs. */
export const commitEventChanges = (
	userId: UserId,
	command: DomainLifecycleCommand,
	changes: ReadonlyArray<EventChange>,
) =>
	Effect.flatMap(ChangeSets, (sets) => sets.commit(eventChanges(userId, changes), command)).pipe(
		Effect.map((result) => result.committed.events.map((event) => event.eventId)),
	);

export const eventMove = (input: {
	readonly eventId: EventId;
	readonly mergeFrom: EntityId;
	readonly mergeInto: EntityId;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly references?: ReadonlyArray<{ readonly from: EntityId; readonly into: EntityId }>;
}): EventChange => ({ ...input, kind: "move", itemIdentity: `event:${input.eventId}` });

/** Clears the user's data for an entity of any schema as a kernel writer, answering its result. */
export const clearUserData = (
	userId: UserId,
	entityId: EntityId,
	command: Omit<DomainLifecycleCommand, "writeContext">,
) =>
	Effect.flatMap(ChangeSets, (sets) =>
		sets.commit(
			{ userId, entities: { clears: [{ entityId, entitySchema: null }] } },
			{ ...command, writeContext: null },
		),
	).pipe(Effect.map((result) => result.cleared[0]));

/** Merges one entity's user data into another of any schema as a kernel writer, answering its result. */
export const mergeUserData = (
	userId: UserId,
	merge: { readonly mergeFrom: EntityId; readonly mergeInto: EntityId },
	command: Omit<DomainLifecycleCommand, "writeContext">,
) =>
	Effect.flatMap(ChangeSets, (sets) =>
		sets.commit(
			{ userId, entities: { merges: [{ ...merge, entitySchema: null }] } },
			{ ...command, writeContext: null },
		),
	).pipe(Effect.map((result) => result.merged[0]));
