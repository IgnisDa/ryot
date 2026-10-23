import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationExecutionId,
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	LifecyclePlanner,
	type LifecyclePlanningResult,
} from "#modules/automations/lifecycle/planning";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventProjectionRepository } from "#modules/events/projection-repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { EventStreamRepository } from "#modules/events/stream-repository";
import {
	EventProjectionBindings,
	EventStreamDispatchWorkflow,
	EventStreamProcessor,
	EventStreamStepWorkflow,
	EventStreamWorkService,
} from "#modules/events/stream-work";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { fixtureManifest } from "#modules/plugins/test-support";
import {
	ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import * as tables from "#schema/tables/combined";
import {
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#testing/effect";

const userId = UserId.make("owner");
const accountToken = "test-account-generation";
const entitySchemaSlug = "fixture-record";
const eventSchemaSlug = EventSchemaSlug.make("record-set");
const processorScriptSlug = "stream-fixture-processor";
const eventSchema: PluginManifest["entitySchemas"][number]["eventSchemas"][number] = {
	name: "Record set",
	slug: eventSchemaSlug,
	propertiesSchema: {
		fields: { rating: { type: "number", label: "Rating", description: "Derived rating" } },
	},
	projection: {
		scriptSlug: processorScriptSlug,
		propertiesSchema: {
			unknownKeys: "strict",
			fields: { score: { type: "number", label: "Score", description: "Computed score" } },
		},
	},
};
const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"));
const isoOccurredAt = "2026-10-05T00:00:00.000Z";
const noHooks: Extract<LifecyclePlanningResult, { _tag: "NoHooks" }> = {
	runs: [],
	policies: [],
	trigger: null,
	_tag: "NoHooks",
	wasCreated: false,
};

const fixturePackage = (): NormalizedPlugin => {
	const fixture = fixtureManifest();
	const [entitySchema] = fixture.entitySchemas;
	assert(entitySchema);
	const script = {
		...emptySandboxExecutionMetadata,
		name: "Processor",
		kind: "script" as const,
		slug: processorScriptSlug,
	};
	const entry = "backend/processor.sandbox.ts";
	const manifest: PluginManifest = {
		...fixture,
		hooks: [],
		workflows: [],
		providers: [],
		signalSchemas: [],
		relationshipSchemas: [],
		scripts: [{ ...script, entry }],
		metadata: { ...fixture.metadata },
		entitySchemas: [
			{
				...entitySchema,
				slug: entitySchemaSlug,
				name: "Fixture record",
				eventSchemas: [eventSchema],
			},
		],
	};
	return {
		manifest,
		contentHash: "stream-fixture-source",
		scripts: [
			{
				entry,
				metadata: script,
				name: script.name,
				slug: script.slug,
				compiledFormat: 1,
				compiledCode: "processor",
				contentHash: "processor-hash",
			},
		],
	};
};

type StreamClaim = Parameters<EventStreamProcessor["Service"]["execute"]>[0];
type ProcessorAction = (claim: StreamClaim, executionId: string) => Effect.Effect<unknown, DbError>;

class StreamWorkFixture extends Context.Service<
	StreamWorkFixture,
	{
		pluginId: PluginId;
		pluginPin: ScriptPluginRevision;
		principal: ScriptExecutionPrincipal;
		processorScriptId: SandboxScriptId;
		accountGeneration: { userId: UserId; token: string };
		entitySchemaSlug: typeof entitySchemaSlug;
	}
>()("test/StreamWorkFixture") {}

class StreamWorkControls extends Context.Service<
	StreamWorkControls,
	{
		setProcessor: (id: string, action: ProcessorAction) => Effect.Effect<void>;
		failLifecycleFor: (executionId: string) => Effect.Effect<void>;
		clearLifecycleFailureFor: (executionId: string) => Effect.Effect<void>;
		processorCalls: Effect.Effect<ReadonlyArray<{ id: string; executionId: string }>>;
		workflowCalls: Effect.Effect<
			ReadonlyArray<{
				name: string;
				executionId: string;
				payload: unknown;
				parentExecutionId: string | null;
			}>
		>;
	}
>()("test/StreamWorkControls") {}

const fixtureLayer = Layer.effect(
	StreamWorkFixture,
	Effect.gen(function* () {
		const installed = yield* installRevisionPackage(fixturePackage(), null);
		const session = yield* DatabaseSession;
		const pluginId = PluginId.make(installed.pluginId);
		const [plugin] = yield* session.run((db) =>
			db
				.select({ configRevisionId: tables.plugin.environmentConfigRevisionId })
				.from(tables.plugin)
				.where(eq(tables.plugin.id, pluginId)),
		);
		assert(plugin?.configRevisionId);
		const script = yield* (yield* PluginRuntimeResolver).findScriptAvailableToUser(
			userId,
			pluginId,
			processorScriptSlug,
		);
		assert(script);
		const subject = {
			userId,
			type: "user" as const,
			accountGeneration: { userId, token: accountToken },
		};
		const pin = yield* (yield* SandboxRepository).getScriptPin(script.id, undefined, subject);
		assert(pin?.pluginRevision);
		const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
		return {
			pluginId,
			principal,
			entitySchemaSlug,
			processorScriptId: script.id,
			pluginPin: pin.pluginRevision,
			accountGeneration: { userId, token: accountToken },
		};
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const streamRepositoryLayer = EventStreamRepository.layer.pipe(Layer.provideMerge(fixtureLayer));
const eventSchemasRepositoryLayer = EventSchemaReader.layer.pipe(Layer.provideMerge(fixtureLayer));
const entitiesRepositoryLayer = EntitiesRepository.layer.pipe(
	Layer.provideMerge(streamRepositoryLayer),
);
const eventsRepositoryLayer = EventsRepository.layer.pipe(
	Layer.provideMerge(streamRepositoryLayer),
);
const repositoriesLayer = Layer.mergeAll(
	streamRepositoryLayer,
	eventSchemasRepositoryLayer,
	entitiesRepositoryLayer,
	eventsRepositoryLayer,
	DomainWriteChecksLive.pipe(Layer.provide(fixtureLayer)),
);
const projectionBindingsLayer = Layer.effect(
	EventProjectionBindings,
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		return {
			resolve: () =>
				Effect.succeed({
					principal: fixture.principal,
					pluginPin: fixture.pluginPin,
					accountGeneration: fixture.accountGeneration,
				}),
		};
	}),
).pipe(Layer.provideMerge(fixtureLayer));

const streamWorkTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const actions = yield* Ref.make(new Map<string, ProcessorAction>());
		const failedLifecycleExecutions = yield* Ref.make(new Set<string>());
		const processorCalls = yield* Ref.make<ReadonlyArray<{ id: string; executionId: string }>>([]);
		const workflowCalls = yield* Ref.make<
			ReadonlyArray<{
				name: string;
				executionId: string;
				payload: unknown;
				parentExecutionId: string | null;
			}>
		>([]);
		const planner = LifecyclePlanner.of(
			withLifecycleBatchPlanning({ plan: () => Effect.succeed(noHooks) }, 200, false),
		);
		const lifecycle = withLifecycleDispatch({
			after: () => Effect.succeed([]),
			skipQueuedPolicies: () => Effect.void,
			executePolicy: () => Effect.die("Unexpected event stream policy"),
		});
		const engine = makeWorkflowEngine({
			execute: (workflow, options) =>
				Effect.gen(function* () {
					const parent = yield* Effect.serviceOption(WorkflowInstance);
					yield* Ref.update(workflowCalls, (calls) => [
						...calls,
						{
							name: workflow._tag,
							payload: options.payload,
							executionId: options.executionId,
							parentExecutionId: Option.match(parent, {
								onNone: () => null,
								onSome: ({ executionId }) => executionId,
							}),
						},
					]);
					return options.executionId;
				}),
		});
		const processor = Layer.succeed(EventStreamProcessor, {
			execute: (claim, executionId) =>
				Effect.gen(function* () {
					yield* Ref.update(processorCalls, (calls) => [...calls, { executionId, id: claim.id }]);
					const action = (yield* Ref.get(actions)).get(claim.id);
					if (!action) {
						return yield* new DbError({
							message: "No event stream processor action was configured",
						});
					}
					return yield* action(claim, executionId);
				}),
		});
		const projectionRepositoryLayer = Layer.effect(
			EventProjectionRepository,
			Effect.gen(function* () {
				const repository = yield* EventProjectionRepository;
				return {
					publish: (input: Parameters<EventProjectionRepository["Service"]["publish"]>[0]) =>
						Effect.gen(function* () {
							yield* repository.publish(input);
							const executions = yield* Ref.get(failedLifecycleExecutions);
							if (
								[...executions].some((executionId) =>
									executionId.startsWith(`event-stream-${input.streamId}-`),
								)
							) {
								return yield* new DbError({ message: "Injected projection failure" });
							}
							return undefined;
						}),
				};
			}),
		).pipe(Layer.provide(EventProjectionRepository.layer));
		const plannerLayer = Layer.succeed(LifecyclePlanner, planner);
		const lifecycleLayer = Layer.succeed(LifecycleExecution, lifecycle);
		const engineLayer = Layer.succeed(WorkflowEngine, engine);
		const sharedDependencies = Layer.mergeAll(
			repositoriesLayer,
			engineLayer,
			WorkflowExecutionNotifications.layer,
			makeAppConfigLayer(),
		);
		const redisLayer = Layer.succeed(
			RedisService,
			makeRedisService({ publish: () => Effect.succeed(0) }),
		);
		const eventsServiceLayer = EventsService.layer.pipe(
			Layer.provideMerge(Layer.mergeAll(sharedDependencies, plannerLayer, lifecycleLayer)),
			Layer.provide(redisLayer),
		);
		const serviceLayer = EventStreamWorkService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					sharedDependencies,
					projectionRepositoryLayer.pipe(Layer.provide(sharedDependencies)),
					projectionBindingsLayer,
					processor,
				),
			),
			Layer.provide(redisLayer),
		);
		const controlsLayer = Layer.succeed(StreamWorkControls, {
			workflowCalls: Ref.get(workflowCalls),
			processorCalls: Ref.get(processorCalls),
			setProcessor: (id, action) =>
				Ref.update(actions, (current) => new Map(current).set(id, action)),
			failLifecycleFor: (executionId) =>
				Ref.update(failedLifecycleExecutions, (current) => new Set(current).add(executionId)),
			clearLifecycleFailureFor: (executionId) =>
				Ref.update(failedLifecycleExecutions, (current) => {
					const next = new Set(current);
					next.delete(executionId);
					return next;
				}),
		});
		return Layer.mergeAll(serviceLayer, eventsServiceLayer, controlsLayer);
	}),
);

const command = (id: string) => ({
	...rootLifecycleCommand({
		source: "api",
		itemIdentity: id,
		lane: "interactive",
		occurredAt: isoOccurredAt,
		initiator: { id: userId, kind: "user" },
		accountGeneration: { userId, token: accountToken },
		executionId: AutomationExecutionId.make(`stream-work-${id}`),
	}),
	writeContext: null,
});

const seedStream = (suffix: string) =>
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		const eventRows = yield* EventsRepository;
		const session = yield* DatabaseSession;
		const service = yield* EventStreamWorkService;
		const entityId = EntityId.make(`stream-${suffix}-record`);
		const eventId = EventId.make(`stream-${suffix}-set`);
		yield* session.transaction(
			session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						userId,
						id: entityId,
						properties: {},
						name: "Fixture record",
						entitySchemaPluginId: fixture.pluginId,
						entitySchemaSlug: fixture.entitySchemaSlug,
					}),
			),
		);
		yield* session.transaction(
			eventRows.createEvent({
				userId,
				entityId,
				occurredAt,
				id: eventId,
				eventSchemaSlug,
				properties: { rating: 1 },
				eventSchemaName: eventSchema.name,
				eventSchemaPluginId: fixture.pluginId,
			}),
		);
		const id = yield* service.request({
			pluginPin: fixture.pluginPin,
			request: { entityId, eventSchemaSlug },
			accountGeneration: fixture.accountGeneration,
			processorScriptId: fixture.processorScriptId,
			command: { ...command(`request-${suffix}`), writeContext: fixture.principal },
		});
		return { id, eventId, fixture, entityId };
	});

const page = (eventId: EventId, rating: number, cursor: string) => ({
	done: false,
	checkpoint: { cursor },
	updates: [{ eventId, properties: { score: rating } }],
});

const process = (claim: Parameters<EventStreamWorkService["Service"]["process"]>[0]) =>
	Effect.gen(function* () {
		const service = yield* EventStreamWorkService;
		const instance = WorkflowInstance.initial(
			EventStreamStepWorkflow,
			`event-stream-${claim.id}-${claim.attempt}`,
		);
		return yield* service
			.process(claim)
			.pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
	});

const sourceState = (eventId: EventId) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [source] = yield* session.run((db) =>
			db
				.select({
					revision: tables.event.revision,
					createdAt: tables.event.createdAt,
					updatedAt: tables.event.updatedAt,
					properties: tables.event.properties,
					occurredAt: tables.event.occurredAt,
				})
				.from(tables.event)
				.where(eq(tables.event.id, eventId)),
		);
		return source ?? null;
	});

const projection = (eventId: EventId) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [published] = yield* session.run((db) =>
			db
				.select({ properties: tables.eventProjection.properties })
				.from(tables.eventProjection)
				.where(eq(tables.eventProjection.eventId, eventId)),
		);
		return published ?? null;
	});

layer(streamWorkTestLayer)((test) => {
	test.effect("registers only the owned event schema and projection declaration", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const { id, fixture } = yield* seedStream("ownership");
			const stream = yield* (yield* EventStreamRepository).get(id);
			assert(stream);
			assert(eventSchema.projection);
			expect(stream.key.eventSchemaPluginId).toBe(fixture.pluginId);
			expect(stream.pluginPin).toEqual({ ...fixture.pluginPin, writeContext: fixture.principal });
			expect(stream.outputSchema).toEqual(eventSchema.projection.propertiesSchema);

			const wrongOwner = yield* Effect.exit(
				service.request({
					accountGeneration: fixture.accountGeneration,
					processorScriptId: SandboxScriptId.make("foreign-processor"),
					pluginPin: { ...fixture.pluginPin, id: PluginId.make("foreign-plugin") },
					command: { ...command("foreign-request"), writeContext: fixture.principal },
					request: { eventSchemaSlug, entityId: EntityId.make("stream-ownership-record") },
				}),
			);
			assertExitFails(
				wrongOwner,
				new DbError({
					message: "Event stream request requires its exact persisted execution authority",
				}),
			);

			const mismatchedProcessor = yield* Effect.exit(
				service.request({
					pluginPin: fixture.pluginPin,
					accountGeneration: fixture.accountGeneration,
					processorScriptId: SandboxScriptId.make("mismatched-processor"),
					request: { eventSchemaSlug, entityId: EntityId.make("stream-ownership-record") },
					command: { ...command("mismatched-processor-request"), writeContext: fixture.principal },
				}),
			);
			assertExitFails(
				mismatchedProcessor,
				new DbError({
					message: "Event stream processor does not belong to the exact admitted plugin revision",
				}),
			);
		}),
	);

	test.effect("commits a page with its checkpoint and admits the next claimed step", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const { id, eventId } = yield* seedStream("page");
			const sourceBefore = yield* sourceState(eventId);
			assert(sourceBefore);
			const claim = yield* service.claim({ id, attempt: 0 });
			assert(claim);
			expect(claim.attempt).toBe(1);
			const claimRevision = claim.revision;
			const claimExecutionId = `event-stream-${id}-${claim.attempt}`;
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 9, "next-page")));

			yield* process(claim);

			const sourceAfter = yield* sourceState(eventId);
			assert(sourceAfter);
			expect(sourceAfter.properties).toEqual({ rating: 1 });
			expect(sourceAfter.occurredAt).toEqual(sourceBefore.occurredAt);
			expect(sourceAfter.createdAt).toEqual(sourceBefore.createdAt);
			expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
			expect(sourceAfter.revision).toBe(sourceBefore.revision);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 9 } });
			const checkpointed = yield* streams.get(id);
			assert(checkpointed);
			expect(checkpointed.checkpoint).toEqual({ cursor: "next-page" });
			expect(checkpointed.status).toBe("queued");
			expect(checkpointed.dirtyFrom).toBeNull();
			expect(checkpointed.streamRevision).toBe(claimRevision);
			expect(checkpointed.claimedRevision).toBe(claimRevision);

			yield* service.dispatch(id);
			const workflows = yield* controls.workflowCalls;
			expect(workflows.at(-1)).toMatchObject({
				payload: { id, attempt: 1 },
				name: "EventStreamStepWorkflow",
				executionId: `event-stream-${id}-2`,
			});

			const nextClaim = yield* service.claim({ id, attempt: 1 });
			assert(nextClaim);
			expect(nextClaim.attempt).toBe(2);
			expect(nextClaim.input.checkpoint).toEqual({ cursor: "next-page" });
			expect((yield* controls.processorCalls)[0]).toEqual({
				id,
				executionId: `${claimExecutionId}-processor`,
			});
		}),
	);

	test.effect("rolls back a failed projection publication and retries the page", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const { id, eventId } = yield* seedStream("retry");
			const sourceBefore = yield* sourceState(eventId);
			assert(sourceBefore);
			const claim = yield* service.claim({ id, attempt: 0 });
			assert(claim);
			const executionId = `event-stream-${id}-${claim.attempt}`;
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 8, "retry-page")));
			yield* controls.failLifecycleFor(executionId);

			assertExitFails(
				yield* Effect.exit(process(claim)),
				new DbError({ message: "Injected projection failure" }),
			);
			const rolledBack = yield* sourceState(eventId);
			assert(rolledBack);
			expect(rolledBack.properties).toEqual({ rating: 1 });
			expect(rolledBack.occurredAt).toEqual(sourceBefore.occurredAt);
			expect(rolledBack.createdAt).toEqual(sourceBefore.createdAt);
			expect(rolledBack.updatedAt).toEqual(sourceBefore.updatedAt);
			expect(rolledBack.revision).toBe(sourceBefore.revision);
			expect(yield* projection(eventId)).toBeNull();
			const pending = yield* streams.get(id);
			assert(pending);
			expect(pending.status).toBe("running");
			expect(pending.checkpoint).toBeNull();

			yield* controls.clearLifecycleFailureFor(executionId);
			yield* process(claim);

			const sourceAfter = yield* sourceState(eventId);
			assert(sourceAfter);
			expect(sourceAfter.properties).toEqual({ rating: 1 });
			expect(sourceAfter.occurredAt).toEqual(sourceBefore.occurredAt);
			expect(sourceAfter.createdAt).toEqual(sourceBefore.createdAt);
			expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
			expect(sourceAfter.revision).toBe(sourceBefore.revision);
			expect(yield* projection(eventId)).toEqual({ properties: { score: 8 } });
			const finished = yield* streams.get(id);
			assert(finished);
			expect(finished.checkpoint).toEqual({ cursor: "retry-page" });
			expect(finished.streamRevision).toBe(claim.revision);
			expect(finished.claimedRevision).toBe(claim.revision);
		}),
	);

	test.effect("dispatches coalesced stream steps independently of ambient workflow parents", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const { id } = yield* seedStream("parent-independent");
			const parentA = WorkflowInstance.initial(EventStreamDispatchWorkflow, "stream-parent-a");
			const parentB = WorkflowInstance.initial(EventStreamDispatchWorkflow, "stream-parent-b");
			yield* service.dispatch(id).pipe(Effect.provideService(WorkflowInstance, parentA));
			yield* service.dispatch(id).pipe(Effect.provideService(WorkflowInstance, parentB));

			const stepExecutionId = `event-stream-${id}-1`;
			const dispatches = (yield* controls.workflowCalls).filter(
				({ executionId }) => executionId === stepExecutionId,
			);
			expect(dispatches).toHaveLength(2);
			expect(dispatches.map(({ parentExecutionId }) => parentExecutionId)).toEqual([null, null]);
			expect(dispatches.map(({ executionId }) => executionId)).toEqual([
				stepExecutionId,
				stepExecutionId,
			]);
		}),
	);

	test.effect(
		"keeps same-attempt claim and reconciliation replays from duplicating a committed projection",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const { id, eventId } = yield* seedStream("replay");
				const sourceBefore = yield* sourceState(eventId);
				assert(sourceBefore);
				const claim = yield* service.claim({ id, attempt: 0 });
				assert(claim);
				const replayedClaim = yield* service.claim({ id, attempt: 0 });
				assert(replayedClaim);
				expect(replayedClaim.attempt).toBe(claim.attempt);
				yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 7, "replay-page")));

				yield* process(claim);
				yield* process(replayedClaim);
				yield* service.reconcile();
				yield* service.reconcile();

				const sourceAfter = yield* sourceState(eventId);
				assert(sourceAfter);
				expect(sourceAfter.properties).toEqual({ rating: 1 });
				expect(sourceAfter.occurredAt).toEqual(sourceBefore.occurredAt);
				expect(sourceAfter.createdAt).toEqual(sourceBefore.createdAt);
				expect(sourceAfter.updatedAt).toEqual(sourceBefore.updatedAt);
				expect(sourceAfter.revision).toBe(sourceBefore.revision);
				expect(yield* projection(eventId)).toEqual({ properties: { score: 7 } });
				const work = yield* streams.get(id);
				assert(work);
				expect(work.checkpoint).toEqual({ cursor: "replay-page" });
				expect(work.streamRevision).toBe(claim.revision);
				expect(work.claimedRevision).toBe(claim.revision);
				const replayDispatches = (yield* controls.workflowCalls).filter(
					({ executionId }) => executionId === `event-stream-${id}-2`,
				);
				expect(replayDispatches).toHaveLength(2);
			}),
	);

	test.effect(
		"rejects foreign events, undeclared properties, duplicate IDs, oversized pages, and malformed output",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const { id, eventId } = yield* seedStream("invalid-output");
				const foreign = yield* seedStream("foreign-output");
				const claim = yield* service.claim({ id, attempt: 0 });
				assert(claim);
				const repeated = page(eventId, 4, "duplicate");
				const tooMany = {
					done: false,
					checkpoint: { cursor: "too-many" },
					updates: Array.from({ length: 101 }, () => repeated.updates[0]),
				};
				const malformed = { done: false, updates: [], checkpoint: undefined };
				const invalidOutputs: ReadonlyArray<{ output: unknown; message: string }> = [
					{
						message: "Projection output targeted an event outside its stream",
						output: {
							...page(eventId, 3, "foreign"),
							updates: [{ ...repeated.updates[0], eventId: foreign.eventId }],
						},
					},
					{
						message: "Projection output does not match its declared schema",
						output: {
							...page(eventId, 3, "undeclared"),
							updates: [{ eventId, properties: { other: 3 } }],
						},
					},
					{
						message: "Event stream processor repeated an event",
						output: { ...repeated, updates: [repeated.updates[0], repeated.updates[0]] },
					},
					{ output: tooMany, message: "Event stream processor returned invalid output" },
					{ output: malformed, message: "Event stream processor returned invalid output" },
					{
						message: "Event stream checkpoint exceeds its bounded size",
						output: { done: false, updates: [], checkpoint: "x".repeat(16_385) },
					},
				];
				for (const { output, message } of invalidOutputs) {
					yield* controls.setProcessor(id, () => Effect.succeed(output));
					assertExitFails(yield* Effect.exit(process(claim)), new DbError({ message }));
				}
			}),
	);

	test.effect(
		"does not commit a processor result after an ordinary source edit invalidates its claim",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const events = yield* EventsRepository;
				const eventService = yield* EventsService;
				const streams = yield* EventStreamRepository;
				const controls = yield* StreamWorkControls;
				const { id, eventId } = yield* seedStream("concurrent-edit");
				const claim = yield* service.claim({ id, attempt: 0 });
				assert(claim);
				yield* controls.setProcessor(id, () =>
					Effect.gen(function* () {
						yield* eventService.edit(
							{ eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
							userId,
							command("ordinary-source-edit"),
						);
						return page(eventId, 9, "stale-result");
					}),
				);

				yield* process(claim);

				const source = yield* events.getEventSnapshot({ userId, eventId });
				assert(source);
				expect(source.properties).toEqual({ rating: 2 });
				const work = yield* streams.get(id);
				assert(work);
				expect(work.status).toBe("queued");
				expect(work.checkpoint).toBeNull();
				expect(work.streamRevision).toBeGreaterThan(claim.revision);
			}),
	);

	test.effect("does not commit a stale processor result after its source event is deleted", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const eventService = yield* EventsService;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			const { id, eventId } = yield* seedStream("deleted-source");
			const claim = yield* service.claim({ id, attempt: 0 });
			assert(claim);
			yield* controls.setProcessor(id, () =>
				Effect.gen(function* () {
					yield* eventService.delete({ userId, eventId }, command("delete-stream-source"));
					return { done: false, updates: [], checkpoint: { cursor: "deleted" } };
				}),
			);

			yield* process(claim);

			expect(yield* events.getEventSnapshot({ userId, eventId })).toBeNull();
			const work = yield* streams.get(id);
			assert(work);
			expect(work.status).toBe("queued");
			expect(work.checkpoint).toBeNull();
			expect(work.streamRevision).toBeGreaterThan(claim.revision);
		}),
	);

	test.effect("blocks stale account-generation admission and claims", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const session = yield* DatabaseSession;
			const { id } = yield* seedStream("retired-account");
			const workflowCallsBefore = yield* controls.workflowCalls;
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "retired-generation" })
					.where(eq(tables.user.id, userId)),
			);

			expect(yield* service.claim({ id, attempt: 0 })).toBeNull();
			assertExitFails(
				yield* Effect.exit(service.dispatch(id)),
				new DbError({ message: "Mutation command belongs to a retired account" }),
			);
			expect(yield* controls.workflowCalls).toHaveLength(workflowCallsBefore.length);
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: accountToken })
					.where(eq(tables.user.id, userId)),
			);
		}),
	);

	test.effect("records a missing processor failure in durable work progress", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			const { id } = yield* seedStream("missing-processor");
			const claim = yield* service.claim({ id, attempt: 0 });
			assert(claim);
			const missingProcessor = new DbError({ message: "Processor script is missing" });
			yield* controls.setProcessor(id, () => Effect.fail(missingProcessor));
			yield* process(claim).pipe(
				Effect.catchTag("DbError", (error) => service.fail(claim.id, claim.attempt, error.message)),
			);

			const failed = yield* streams.get(id);
			assert(failed);
			expect(failed.status).toBe("failed");
			expect(failed.error).toBe("Processor script is missing");
		}),
	);
});
