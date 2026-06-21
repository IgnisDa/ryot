import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import {
	dbRunnerLayer,
	makeWorkflowActivityEngine,
	type MockOverrides,
} from "#lib/test-support/effect";

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

const makeMediaMonitoringRepository = (
	overrides: MockOverrides<typeof mediaMonitoringRepositoryMock> = {},
) =>
	mediaMonitoringRepositoryMock({
		getSnapshot: () => Effect.succeed(null),
		listSubscribers: () => Effect.succeed([]),
		...overrides,
		_tag: "MediaMonitoringRepository",
	});

type ExecuteStub = (
	...args: Parameters<WorkflowEngine["Type"]["execute"]>
) => Effect.Effect<unknown, unknown>;

type TestOptions = {
	population?: ExecuteStub;
	onDelivery?: ExecuteStub;
	mediaMonitoringRepository?: Layer.Layer<MediaMonitoringRepository>;
};

const makeLayer = (options: TestOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		options.mediaMonitoringRepository ?? makeMediaMonitoringRepository(),
	);

const runWithLayer = <A, E, R>(options: TestOptions, effect: Effect.Effect<A, E, R>) => {
	const instance = WorkflowInstance.initial(MediaMonitoringRefreshWorkflow, payload.executionId);
	const population = options.population ?? (() => Effect.succeed(entity));
	const onDelivery = options.onDelivery ?? (() => Effect.void);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (workflow, execOptions) =>
			workflow.name === "NotificationDeliveryWorkflow"
				? onDelivery(workflow, execOptions)
				: population(workflow, execOptions),
	});
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
			population: () =>
				Effect.sync(() => {
					synchronized = true;
					return entity;
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
	const order: Array<"snapshot" | "population"> = [];
	const populationCalls: unknown[] = [];
	const deliveries: unknown[] = [];
	const before = snapshot("Continuing");
	const after = snapshot("Ended");
	const change = diffMediaMonitoringSnapshots(before, after)[0];

	return runWithLayer(
		{
			mediaMonitoringRepository: makeMediaMonitoringRepository({
				getSnapshot: () =>
					Effect.sync(() => {
						order.push("snapshot");
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
			onDelivery: (_workflow, execOptions) =>
				Effect.sync(() => {
					deliveries.push(execOptions.payload);
					return execOptions.executionId;
				}),
			population: (_workflow, execOptions) =>
				Effect.sync(() => {
					order.push("population");
					populationCalls.push(execOptions);
					return entity;
				}),
		},
		Effect.gen(function* () {
			yield* runMediaMonitoringRefreshWorkflow(payload);
			expect(order).toEqual(["snapshot", "population", "snapshot"]);
			expect(snapshotReads).toBe(2);
			expect(change).toBeDefined();
			expect(populationCalls).toMatchObject([
				{
					payload: { mode: "refresh" },
					executionId: `${payload.executionId}-provider-refresh`,
				},
			]);
			expect(deliveries).toEqual([
				{
					userId: UserId.make("user-b"),
					executionId: `${payload.executionId}-user-b-${change?.fingerprint}`,
					request: {
						kind: "event",
						eventType: "metadata_status_changed",
						message: "Status of Media Monitoring Target changed from Continuing to Ended",
					},
				},
			]);
		}),
	);
});

it.effect("does not diff or notify when provider population fails", () => {
	let snapshotReads = 0;
	let afterSnapshotRead = false;
	const deliveries: unknown[] = [];

	return runWithLayer(
		{
			mediaMonitoringRepository: makeMediaMonitoringRepository({
				getSnapshot: () =>
					Effect.sync(() => {
						snapshotReads += 1;
						if (snapshotReads > 1) {
							afterSnapshotRead = true;
						}
						return snapshot("Continuing");
					}),
				listSubscribers: () => Effect.succeed([UserId.make("user-a")]),
			}),
			onDelivery: (_workflow, execOptions) =>
				Effect.sync(() => {
					deliveries.push(execOptions.payload);
					return execOptions.executionId;
				}),
			population: () => Effect.fail(new SandboxRunError({ message: "provider boom" })),
		},
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runMediaMonitoringRefreshWorkflow(payload));
			expect(exit._tag).toBe("Failure");
			expect(afterSnapshotRead).toBe(false);
			expect(deliveries).toEqual([]);
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
			onDelivery: (_workflow, execOptions) =>
				Effect.sync(() => {
					deliveries.push(execOptions.payload);
					return execOptions.executionId;
				}),
		},
		Effect.gen(function* () {
			yield* runMediaMonitoringRefreshWorkflow(payload);
			expect(deliveries).toEqual([]);
		}),
	);
});
