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
import { EntitiesService } from "#modules/entities/service";
import {
	EntityImportWorkflowOperations,
	type EntityImportWorkflowOperationsValue,
} from "#modules/entity-import/operations-workflow";
import { NotificationsService } from "#modules/notifications/service";

import { diffMonitoringSnapshots, type MonitoringSnapshot } from "./diff";
import {
	MonitoringRefreshWorkflow,
	type MonitoringRefreshPayload,
	runMonitoringRefreshWorkflow,
} from "./refresh-workflow";
import { MonitoringRepository } from "./repository";

const now = "2026-06-14T00:00:00.000Z";

const payload = {
	entitySchemaSlug: "movie",
	externalId: "provider-movie",
	executionId: "monitoring-run",
	entityId: EntityId.make("monitoring-entity"),
	entitySchemaId: EntitySchemaId.make("schema-movie"),
	sandboxScriptId: SandboxScriptId.make("provider-script"),
} satisfies MonitoringRefreshPayload;

const entity = {
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	id: payload.entityId,
	name: "Monitoring Target",
	externalId: payload.externalId,
	entitySchemaId: payload.entitySchemaId,
	sandboxScriptId: payload.sandboxScriptId,
	properties: { productionStatus: "Ended" },
} satisfies ListedEntity;

const snapshot = (status: string, populatedAt: string | null = now): MonitoringSnapshot => ({
	seasons: [],
	populatedAt,
	associations: [],
	entityKind: "media",
	animeEpisodes: null,
	mangaChapters: null,
	podcastEpisodes: [],
	entitySchemaSlug: "movie",
	name: "Monitoring Target",
	entityId: payload.entityId,
	properties: { productionStatus: status },
});

const monitoringRepositoryMock = Layer.mock(MonitoringRepository);
const notificationsServiceMock = Layer.mock(NotificationsService);
const entitiesServiceMock = Layer.mock(EntitiesService);

const makeMonitoringRepository = (overrides: MockOverrides<typeof monitoringRepositoryMock> = {}) =>
	monitoringRepositoryMock({
		getSnapshot: () => Effect.succeed(null),
		listSubscribers: () => Effect.succeed([]),
		...overrides,
		_tag: "MonitoringRepository",
	});

const makeNotificationsService = (overrides: MockOverrides<typeof notificationsServiceMock> = {}) =>
	notificationsServiceMock({
		trigger: () => Effect.void,
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
	monitoringRepository?: Layer.Layer<MonitoringRepository>;
	notificationsService?: Layer.Layer<NotificationsService>;
	processSandbox?: EntityImportWorkflowOperationsValue["processSandbox"];
};

const makeLayer = (options: TestOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(0) })),
		options.entitiesService ?? makeEntitiesService(),
		options.monitoringRepository ?? makeMonitoringRepository(),
		options.notificationsService ?? makeNotificationsService(),
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
	const instance = WorkflowInstance.initial(MonitoringRefreshWorkflow, payload.executionId);
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
			monitoringRepository: makeMonitoringRepository({ listSubscribers: () => Effect.succeed([]) }),
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
			yield* runMonitoringRefreshWorkflow(payload);
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
	const change = diffMonitoringSnapshots(before, after)[0];

	return runWithLayer(
		{
			monitoringRepository: makeMonitoringRepository({
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
			yield* runMonitoringRefreshWorkflow(payload);
			expect(synchronizations).toBe(1);
			expect(snapshotReads).toBe(2);
			expect(change).toBeDefined();
			expect(deliveries).toEqual([
				{
					userId: UserId.make("user-b"),
					eventType: "metadata_status_changed",
					message: "Status of Monitoring Target changed from Continuing to Ended",
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
			monitoringRepository: makeMonitoringRepository({
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
					}),
			}),
		},
		Effect.gen(function* () {
			yield* runMonitoringRefreshWorkflow(payload);
			expect(deliveries).toEqual([]);
		}),
	);
});
