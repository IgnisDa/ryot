import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationExecutionId,
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecyclePlanner, type LifecyclePlanningResult } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { EventStreamRepository } from "#modules/events/stream-repository";
import {
	EventStreamDispatchWorkflow,
	EventStreamProcessor,
	EventStreamWorkService,
} from "#modules/events/stream-work";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";
import { fixtureManifest } from "#modules/plugins/test-support";
import type { NormalizedPlugin } from "#modules/plugins/types";

const userId = UserId.make("owner");
const accountToken = "test-account-generation";
const entitySchemaSlug = "fixture-exercise";
const eventSchemaSlug = EventSchemaSlug.make("workout-set");
const eventSchema: PluginManifest["entitySchemas"][number]["eventSchemas"][number] = {
	name: "Workout set",
	slug: eventSchemaSlug,
	propertiesSchema: {
		fields: { rating: { type: "number", label: "Rating", description: "Derived rating" } },
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
	const manifest: PluginManifest = {
		...fixture,
		hooks: [],
		scripts: [],
		workflows: [],
		providers: [],
		signalSchemas: [],
		relationshipSchemas: [],
		metadata: { ...fixture.metadata, slug: "stream-fixture" },
		entitySchemas: [
			{
				...entitySchema,
				slug: entitySchemaSlug,
				name: "Fixture exercise",
				eventSchemas: [eventSchema],
			},
		],
	};
	return { manifest, scripts: [], sourceHash: "stream-fixture-source" };
};

type StreamClaim = Parameters<EventStreamProcessor["Service"]["execute"]>[0];
type ProcessorAction = (claim: StreamClaim, executionId: string) => Effect.Effect<unknown, DbError>;

class StreamWorkFixture extends Context.Service<
	StreamWorkFixture,
	{
		pluginId: PluginId;
		pluginPin: SandboxPluginRevision;
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
		requestOccurredAts: Effect.Effect<ReadonlyArray<string>>;
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
		return {
			pluginId,
			entitySchemaSlug,
			accountGeneration: { userId, token: accountToken },
			pluginPin: {
				id: pluginId,
				ownerId: null,
				scope: "system",
				compiledHashes: {},
				workflowScripts: {},
				slug: "stream-fixture",
				userBootstrapScriptSlugs: [],
				configSchema: fixturePackage().manifest.configSchema,
				revisionId: PluginRevisionId.make(installed.revisionId),
				configRevisionId: PluginConfigRevisionId.make(plugin.configRevisionId),
				schemaScope: {
					relationshipSchemaSlugs: [],
					entitySchemaSlugs: [entitySchemaSlug],
					eventSchemas: [{ eventSchemaSlug, entitySchemaSlug }],
				},
			},
		};
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const streamRepositoryLayer = EventStreamRepository.layer.pipe(Layer.provideMerge(fixtureLayer));
const eventSchemasRepositoryLayer = EventSchemasRepository.layer.pipe(
	Layer.provideMerge(fixtureLayer),
);
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
);

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
		const requestOccurredAts = yield* Ref.make<ReadonlyArray<string>>([]);
		const planner = LifecyclePlanner.of(
			withLifecycleBatchPlanning(
				{
					plan: ({ trigger }) =>
						Effect.gen(function* () {
							if (trigger.kind.category === "request") {
								yield* Ref.update(requestOccurredAts, (values) => [...values, trigger.occurredAt]);
							}
							if (
								trigger.kind.category === "change" &&
								(yield* Ref.get(failedLifecycleExecutions)).has(trigger.causation.executionId)
							) {
								return yield* new DbError({ message: "Injected lifecycle planning failure" });
							}
							return noHooks;
						}),
				},
				200,
				false,
			),
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
		const plannerLayer = Layer.succeed(LifecyclePlanner, planner);
		const lifecycleLayer = Layer.succeed(LifecycleExecution, lifecycle);
		const engineLayer = Layer.succeed(WorkflowEngine, engine);
		const eventsServiceLayer = EventsService.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					repositoriesLayer,
					plannerLayer,
					lifecycleLayer,
					engineLayer,
					makeAppConfigLayer(),
				),
			),
		);
		const serviceLayer = EventStreamWorkService.layer.pipe(
			Layer.provideMerge(Layer.merge(eventsServiceLayer, processor)),
		);
		const controlsLayer = Layer.succeed(StreamWorkControls, {
			workflowCalls: Ref.get(workflowCalls),
			processorCalls: Ref.get(processorCalls),
			requestOccurredAts: Ref.get(requestOccurredAts),
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
		return Layer.merge(serviceLayer, controlsLayer);
	}),
);

const command = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		itemIdentity: id,
		lane: "interactive",
		occurredAt: isoOccurredAt,
		initiator: { id: userId, kind: "user" },
		accountGeneration: { userId, token: accountToken },
		executionId: AutomationExecutionId.make(`stream-work-${id}`),
	});

const seedStream = (suffix: string) =>
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		const eventRows = yield* EventsRepository;
		const session = yield* DatabaseSession;
		const service = yield* EventStreamWorkService;
		const entityId = EntityId.make(`stream-${suffix}-exercise`);
		const eventId = EventId.make(`stream-${suffix}-set`);
		yield* session.transaction(
			session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						userId,
						id: entityId,
						properties: {},
						name: "Fixture exercise",
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
			accountGeneration: fixture.accountGeneration,
			processorScriptId: SandboxScriptId.make("stream-fixture-processor"),
			request: { entityId, eventSchemaSlug, outputProperties: ["rating"] },
		});
		return { id, eventId, fixture, entityId };
	});

const page = (eventId: EventId, rating: number, cursor: string) => ({
	done: false,
	checkpoint: { cursor },
	updates: [{ eventId, patch: { properties: { remove: [], set: { rating } } } }],
});

layer(streamWorkTestLayer)((test) => {
	test.effect("registers only the owned event schema and declared output properties", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const { id, fixture } = yield* seedStream("ownership");
			const stream = yield* (yield* EventStreamRepository).get(id);
			assert(stream);
			expect(stream.key.eventSchemaPluginId).toBe(fixture.pluginId);
			expect(stream.pluginPin).toEqual(fixture.pluginPin);
			expect(stream.outputProperties).toEqual(["rating"]);

			const wrongOwner = yield* Effect.exit(
				service.request({
					accountGeneration: fixture.accountGeneration,
					processorScriptId: SandboxScriptId.make("foreign-processor"),
					pluginPin: { ...fixture.pluginPin, id: PluginId.make("foreign-plugin") },
					request: {
						eventSchemaSlug,
						outputProperties: ["rating"],
						entityId: EntityId.make("stream-ownership-exercise"),
					},
				}),
			);
			assertExitFails(
				wrongOwner,
				new DbError({
					message: "Event stream processor must own its schema and declared output properties",
				}),
			);

			const undeclared = yield* Effect.exit(
				service.request({
					pluginPin: fixture.pluginPin,
					accountGeneration: fixture.accountGeneration,
					processorScriptId: SandboxScriptId.make("undeclared-processor"),
					request: {
						eventSchemaSlug,
						outputProperties: ["not-declared"],
						entityId: EntityId.make("stream-ownership-exercise"),
					},
				}),
			);
			assertExitFails(
				undeclared,
				new DbError({
					message: "Event stream processor must own its schema and declared output properties",
				}),
			);
		}),
	);

	test.effect("commits a page with its checkpoint and admits the next claimed step", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const events = yield* EventsRepository;
			const { id, eventId } = yield* seedStream("page");
			const claim = yield* service.claim({ id, attempt: 0 });
			assert(claim);
			expect(claim.attempt).toBe(1);
			const claimRevision = claim.revision;
			const claimExecutionId = `event-stream-${id}-${claim.attempt}`;
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 9, "next-page")));

			yield* service.process(claim);

			const updated = yield* events.getEventSnapshot({ userId, eventId });
			assert(updated);
			expect(updated.properties).toEqual({ rating: 9 });
			const checkpointed = yield* streams.get(id);
			assert(checkpointed);
			expect(checkpointed.checkpoint).toEqual({ cursor: "next-page" });
			expect(checkpointed.status).toBe("queued");
			expect(checkpointed.dirtyFrom).toBeNull();
			expect(checkpointed.streamRevision).toBe(claimRevision + 1);
			expect(checkpointed.claimedRevision).toBe(claimRevision + 1);

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

	test.effect(
		"retries a prepared update with the persisted claim time after rolling back change planning",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const events = yield* EventsRepository;
				const session = yield* DatabaseSession;
				const { id, eventId } = yield* seedStream("retry");
				const [before] = yield* session.run((db) =>
					db
						.select({ revision: tables.event.revision })
						.from(tables.event)
						.where(eq(tables.event.id, eventId)),
				);
				assert(before);
				const claim = yield* service.claim({ id, attempt: 0 });
				assert(claim);
				const executionId = `event-stream-${id}-${claim.attempt}`;
				const requestTimesBefore = (yield* controls.requestOccurredAts).length;
				yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 8, "retry-page")));
				yield* controls.failLifecycleFor(executionId);

				assertExitFails(
					yield* Effect.exit(service.process(claim)),
					new DbError({ message: "Injected lifecycle planning failure" }),
				);
				const rolledBack = yield* events.getEventSnapshot({ userId, eventId });
				assert(rolledBack);
				expect(rolledBack.properties).toEqual({ rating: 1 });
				const [afterRollback] = yield* session.run((db) =>
					db
						.select({ revision: tables.event.revision })
						.from(tables.event)
						.where(eq(tables.event.id, eventId)),
				);
				expect(afterRollback?.revision).toBe(before.revision);
				expect((yield* controls.requestOccurredAts).slice(requestTimesBefore)).toEqual([
					claim.occurredAt,
				]);
				const pending = yield* streams.get(id);
				assert(pending);
				expect(pending.status).toBe("running");
				expect(pending.checkpoint).toBeNull();

				yield* controls.clearLifecycleFailureFor(executionId);
				yield* TestClock.adjust("1 second");
				yield* service.process(claim);

				const committed = yield* events.getEventSnapshot({ userId, eventId });
				assert(committed);
				expect(committed.properties).toEqual({ rating: 8 });
				expect(committed.updatedAt).toBe(claim.occurredAt);
				const [afterCommit] = yield* session.run((db) =>
					db
						.select({ revision: tables.event.revision })
						.from(tables.event)
						.where(eq(tables.event.id, eventId)),
				);
				expect(afterCommit?.revision).toBe(before.revision + 1);
				expect((yield* controls.requestOccurredAts).slice(requestTimesBefore)).toEqual([
					claim.occurredAt,
					claim.occurredAt,
				]);
				const finished = yield* streams.get(id);
				assert(finished);
				expect(finished.checkpoint).toEqual({ cursor: "retry-page" });
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
		"keeps same-attempt claim and reconciliation replays from duplicating a committed update",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const events = yield* EventsRepository;
				const { id, eventId } = yield* seedStream("replay");
				const claim = yield* service.claim({ id, attempt: 0 });
				assert(claim);
				const replayedClaim = yield* service.claim({ id, attempt: 0 });
				assert(replayedClaim);
				expect(replayedClaim.attempt).toBe(claim.attempt);
				yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 7, "replay-page")));

				yield* service.process(claim);
				yield* service.process(replayedClaim);
				yield* service.reconcile();
				yield* service.reconcile();

				const updated = yield* events.getEventSnapshot({ userId, eventId });
				assert(updated);
				expect(updated.properties).toEqual({ rating: 7 });
				expect(updated.updatedAt).toBe(claim.occurredAt);
				const work = yield* streams.get(id);
				assert(work);
				expect(work.checkpoint).toEqual({ cursor: "replay-page" });
				expect(work.streamRevision).toBe(claim.revision + 1);
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
						message: "Event stream processor targeted an event outside its stream",
						output: {
							...page(eventId, 3, "foreign"),
							updates: [{ ...repeated.updates[0], eventId: foreign.eventId }],
						},
					},
					{
						message: "Event stream processor wrote outside its declared outputs",
						output: {
							...page(eventId, 3, "undeclared"),
							updates: [{ eventId, patch: { properties: { remove: [], set: { other: 3 } } } }],
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
					assertExitFails(yield* Effect.exit(service.process(claim)), new DbError({ message }));
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

				yield* service.process(claim);

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

			yield* service.process(claim);

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
			yield* service
				.process(claim)
				.pipe(
					Effect.catchTag("DbError", (error) =>
						service.fail(claim.id, claim.attempt, error.message),
					),
				);

			const failed = yield* streams.get(id);
			assert(failed);
			expect(failed.status).toBe("failed");
			expect(failed.error).toBe("Processor script is missing");
		}),
	);
});
