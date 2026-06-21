import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import {
	dbRunnerLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	type MockOverrides,
} from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import {
	EntityImportWorkflowOperations,
	type EntityImportWorkflowOperationsValue,
} from "#modules/entity-import/operations-workflow";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { NotificationsService } from "#modules/notifications/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { diffMediaMonitoringSnapshots, type MediaMonitoringSnapshot } from "./diff";
import {
	MediaMonitoringRefreshWorkflow,
	type MediaMonitoringRefreshPayload,
	runMediaMonitoringRefreshWorkflow,
} from "./refresh-workflow";
import { MediaMonitoringRepository } from "./repository";

const now = "2026-06-14T00:00:00.000Z";

const payload = {
	entitySchemaSlug: "movie",
	externalId: "provider-movie",
	executionId: "media-monitoring-run",
	entityId: EntityId.make("media-monitoring-entity"),
	entitySchemaId: EntitySchemaId.make("schema-movie"),
	sandboxScriptId: SandboxScriptId.make("provider-script"),
} satisfies MediaMonitoringRefreshPayload;

const entity = {
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	id: payload.entityId,
	name: "Media Monitoring Target",
	externalId: payload.externalId,
	entitySchemaId: payload.entitySchemaId,
	sandboxScriptId: payload.sandboxScriptId,
	properties: { productionStatus: "Ended" },
} satisfies ListedEntity;

const snapshot = (status: string, populatedAt: string | null = now) =>
	({
		seasons: [],
		populatedAt,
		associations: [],
		entityKind: "media",
		animeEpisodes: null,
		mangaChapters: null,
		podcastEpisodes: [],
		entitySchemaSlug: "movie",
		entityId: payload.entityId,
		name: "Media Monitoring Target",
		properties: { productionStatus: status },
	}) satisfies MediaMonitoringSnapshot;

const mediaMonitoringRepositoryMock = Layer.mock(MediaMonitoringRepository);
const notificationsServiceMock = Layer.mock(NotificationsService);
const entitiesServiceMock = Layer.mock(EntitiesService);
const entitiesRepositoryMock = Layer.mock(EntitiesRepository);
const entitySchemasRepositoryMock = Layer.mock(EntitySchemasRepository);
const relationshipsRepositoryMock = Layer.mock(RelationshipsRepository);
const relationshipSchemasRepositoryMock = Layer.mock(RelationshipSchemasRepository);
const relationshipsServiceMock = Layer.mock(RelationshipsService);

const makeMediaMonitoringRepository = (
	overrides: MockOverrides<typeof mediaMonitoringRepositoryMock> = {},
) =>
	mediaMonitoringRepositoryMock({
		getSnapshot: () => Effect.succeed(null),
		listSubscribers: () => Effect.succeed([]),
		...overrides,
		_tag: "MediaMonitoringRepository",
	});

const makeNotificationsService = (overrides: MockOverrides<typeof notificationsServiceMock> = {}) =>
	notificationsServiceMock({
		trigger: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
		_tag: "NotificationsService",
	});

const makeEntitiesService = (overrides: MockOverrides<typeof entitiesServiceMock> = {}) =>
	entitiesServiceMock({
		save: () => Effect.succeed(entity),
		...overrides,
		_tag: "EntitiesService",
	});

type TestOptions = {
	entitiesService?: Layer.Layer<EntitiesService>;
	mediaMonitoringRepository?: Layer.Layer<MediaMonitoringRepository>;
	notificationsService?: Layer.Layer<NotificationsService>;
	processSandbox?: EntityImportWorkflowOperationsValue["processSandbox"];
};

const makeLayer = (options: TestOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(0) })),
		options.entitiesService ?? makeEntitiesService(),
		entitiesRepositoryMock({ _tag: "EntitiesRepository" }),
		entitySchemasRepositoryMock({ _tag: "EntitySchemasRepository" }),
		options.mediaMonitoringRepository ?? makeMediaMonitoringRepository(),
		options.notificationsService ?? makeNotificationsService(),
		relationshipsRepositoryMock({ _tag: "RelationshipsRepository" }),
		relationshipSchemasRepositoryMock({ _tag: "RelationshipSchemasRepository" }),
		relationshipsServiceMock({ _tag: "RelationshipsService" }),
		Layer.mock(EntityImportWorkflowOperations, {
			processSandbox:
				options.processSandbox ??
				(() =>
					Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: { name: entity.name, properties: entity.properties },
					})),
		}),
	);

const runWithLayer = <A, E, R>(options: TestOptions, effect: Effect.Effect<A, E, R>) => {
	const instance = WorkflowInstance.initial(MediaMonitoringRefreshWorkflow, payload.executionId);
	const engine = makeWorkflowActivityEngine(instance);
	return effect.pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, engine),
		Effect.provide(makeLayer(options)),
	);
};

it.effect("skips provider synchronization when a target has no current subscribers", () => {
	let synchronized = false;

	return runWithLayer(
		{
			mediaMonitoringRepository: makeMediaMonitoringRepository({
				listSubscribers: () => Effect.succeed([]),
			}),
			processSandbox: () =>
				Effect.sync(() => {
					synchronized = true;
					return {
						logs: [],
						error: null,
						status: "completed" as const,
						value: { name: entity.name, properties: entity.properties },
					};
				}),
		},
		Effect.gen(function* () {
			yield* runMediaMonitoringRefreshWorkflow(payload);
			expect(synchronized).toBe(false);
		}),
	);
});

it.effect("refreshes once and sends deterministic deliveries only to current subscribers", () => {
	let snapshotReads = 0;
	let subscriberReads = 0;
	let synchronizations = 0;
	const deliveries: Array<{
		userId: UserId;
		message: string;
		eventType: string;
		executionId?: string;
	}> = [];
	const before = snapshot("Continuing");
	const after = snapshot("Ended");
	const change = diffMediaMonitoringSnapshots(before, after)[0];

	return runWithLayer(
		{
			mediaMonitoringRepository: makeMediaMonitoringRepository({
				getSnapshot: () =>
					Effect.sync(() => {
						snapshotReads += 1;
						return snapshotReads === 1 ? before : after;
					}),
				listSubscribers: () =>
					Effect.sync(() => {
						subscriberReads += 1;
						return subscriberReads === 1
							? [UserId.make("user-a"), UserId.make("user-b")]
							: [UserId.make("user-b")];
					}),
			}),
			notificationsService: makeNotificationsService({
				trigger: (input) =>
					Effect.sync(() => {
						deliveries.push(input);
						return undefined;
					}),
			}),
			processSandbox: () =>
				Effect.sync(() => {
					synchronizations += 1;
					return {
						logs: [],
						error: null,
						status: "completed" as const,
						value: { name: entity.name, properties: after.properties },
					};
				}),
		},
		Effect.gen(function* () {
			yield* runMediaMonitoringRefreshWorkflow(payload);
			expect(synchronizations).toBe(1);
			expect(snapshotReads).toBe(2);
			expect(change).toBeDefined();
			expect(deliveries).toEqual([
				{
					userId: UserId.make("user-b"),
					eventType: "metadata_status_changed",
					message: "Status of Media Monitoring Target changed from Continuing to Ended",
					executionId: `${payload.executionId}-user-b-${change?.fingerprint}`,
				},
			]);
		}),
	);
});

it.effect("treats an incomplete persisted target as a silent baseline", () => {
	const deliveries: unknown[] = [];
	let snapshotReads = 0;

	return runWithLayer(
		{
			mediaMonitoringRepository: makeMediaMonitoringRepository({
				getSnapshot: () =>
					Effect.sync(() => {
						snapshotReads += 1;
						return snapshotReads === 1 ? snapshot("Continuing", null) : snapshot("Ended");
					}),
				listSubscribers: () => Effect.succeed([UserId.make("user-a")]),
			}),
			notificationsService: makeNotificationsService({
				trigger: (input) =>
					Effect.sync(() => {
						deliveries.push(input);
						return undefined;
					}),
			}),
		},
		Effect.gen(function* () {
			yield* runMediaMonitoringRefreshWorkflow(payload);
			expect(deliveries).toEqual([]);
		}),
	);
});
