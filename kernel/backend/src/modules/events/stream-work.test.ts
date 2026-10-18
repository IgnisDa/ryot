import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EventStreamStepInput } from "@ryot-app/contract/modules/events/stream-work";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationExecutionId,
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginConfigRevisionId,
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
import type { BackgroundWorkInput } from "#modules/background-work/model";
import { ProjectionBindings } from "#modules/background-work/model";
import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventProjectionRepository } from "#modules/events/projection-repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { EventStreamWorkService } from "#modules/events/stream-work";
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

type ProjectionBinding = NonNullable<
	Effect.Success<ReturnType<ProjectionBindings["Service"]["resolve"]>>
>;

type ProcessorAction = (
	input: typeof EventStreamStepInput.Type,
	jobId: string,
) => Effect.Effect<unknown, DbError>;

type StreamWorkCall =
	| { inTransaction: boolean; operation: "lockAccount" }
	| { id: string; operation: "prepare"; inTransaction: boolean };

class StreamWorkRecorder extends Context.Service<
	StreamWorkRecorder,
	{ record: (call: StreamWorkCall) => Effect.Effect<void> }
>()("test/StreamWorkRecorder") {}

class ProjectionBindingControl extends Context.Service<
	ProjectionBindingControl,
	{ set: (binding: ProjectionBinding) => Effect.Effect<void> }
>()("test/ProjectionBindingControl") {}

class StreamWorkFixture extends Context.Service<
	StreamWorkFixture,
	{
		pluginId: PluginId;
		pluginPin: ScriptPluginRevision;
		processorScriptId: SandboxScriptId;
		principal: ScriptExecutionPrincipal;
		entitySchemaSlug: typeof entitySchemaSlug;
		accountGeneration: { token: string; userId: UserId };
	}
>()("test/StreamWorkFixture") {}

class StreamWorkControls extends Context.Service<
	StreamWorkControls,
	{
		failProjectionFor: (streamId: string) => Effect.Effect<void>;
		admissionCalls: Effect.Effect<ReadonlyArray<StreamWorkCall>>;
		clearProjectionFailureFor: (streamId: string) => Effect.Effect<void>;
		setProcessor: (id: string, action: ProcessorAction) => Effect.Effect<void>;
		processorCalls: Effect.Effect<ReadonlyArray<{ id: string; jobId: string }>>;
		runProcessor: (
			streamId: string,
			input: typeof EventStreamStepInput.Type,
			jobId: string,
		) => Effect.Effect<unknown, DbError>;
		workflowCalls: Effect.Effect<
			ReadonlyArray<{
				name: string;
				payload: unknown;
				executionId: string;
				inTransaction: boolean;
				parentExecutionId: null | string;
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

const baseStreamRepositoryLayer = EventStreamRepository.layer.pipe(
	Layer.provideMerge(fixtureLayer),
);
const streamRepositoryImplementationLayer = Layer.effect(
	EventStreamRepository,
	Effect.gen(function* () {
		const repository = yield* EventStreamRepository;
		const recorder = yield* StreamWorkRecorder;
		const session = yield* DatabaseSession;
		return {
			...repository,
			prepare: (id: Parameters<typeof repository.prepare>[0]) =>
				Effect.gen(function* () {
					yield* recorder.record({
						id,
						operation: "prepare",
						inTransaction: yield* session.isTransactionActive,
					});
					return yield* repository.prepare(id);
				}),
		};
	}),
).pipe(Layer.provide(baseStreamRepositoryLayer));
const streamRepositoryLayer = Layer.merge(streamRepositoryImplementationLayer, fixtureLayer);
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
const projectionBindingsLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		const current = yield* Ref.make<ProjectionBinding>({
			principal: fixture.principal,
			pluginPin: fixture.pluginPin,
			accountGeneration: fixture.accountGeneration,
		});
		return Layer.merge(
			Layer.succeed(ProjectionBindings, { resolve: () => Ref.get(current) }),
			Layer.succeed(ProjectionBindingControl, { set: (binding) => Ref.set(current, binding) }),
		);
	}),
).pipe(Layer.provideMerge(fixtureLayer));

const streamWorkTestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const actions = yield* Ref.make(new Map<string, ProcessorAction>());
		const failedProjectionStreams = yield* Ref.make(new Set<string>());
		const processorCalls = yield* Ref.make<ReadonlyArray<{ id: string; jobId: string }>>([]);
		const workflowCalls = yield* Ref.make<
			ReadonlyArray<{
				name: string;
				payload: unknown;
				executionId: string;
				inTransaction: boolean;
				parentExecutionId: null | string;
			}>
		>([]);
		const admissionCalls = yield* Ref.make<ReadonlyArray<StreamWorkCall>>([]);
		const recorder = {
			record: (call: StreamWorkCall) => Ref.update(admissionCalls, (calls) => [...calls, call]),
		};
		const recorderLayer = Layer.succeed(StreamWorkRecorder, recorder);
		const planner = LifecyclePlanner.of(
			withLifecycleBatchPlanning({ plan: () => Effect.succeed(noHooks) }, 200, false),
		);
		const lifecycle = withLifecycleDispatch({
			after: () => Effect.succeed([]),
			skipQueuedPolicies: () => Effect.void,
			executePolicy: () => Effect.die("Unexpected event stream policy"),
		});
		const engineLayer = Layer.effect(
			WorkflowEngine,
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				return makeWorkflowEngine({
					execute: (workflow, options) =>
						Effect.gen(function* () {
							const parent = yield* Effect.serviceOption(WorkflowInstance);
							const inTransaction = yield* session.isTransactionActive;
							yield* Ref.update(workflowCalls, (calls) => [
								...calls,
								{
									inTransaction,
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
			}),
		).pipe(Layer.provideMerge(fixtureLayer));
		const projectionRepositoryLayer = Layer.effect(
			EventProjectionRepository,
			Effect.gen(function* () {
				const repository = yield* EventProjectionRepository;
				return {
					publish: (input: Parameters<EventProjectionRepository["Service"]["publish"]>[0]) =>
						Effect.gen(function* () {
							yield* repository.publish(input);
							if ((yield* Ref.get(failedProjectionStreams)).has(input.streamId)) {
								return yield* new DbError({ message: "Injected projection failure" });
							}
							return undefined;
						}),
				};
			}),
		).pipe(Layer.provide(EventProjectionRepository.layer));
		const plannerLayer = Layer.succeed(LifecyclePlanner, planner);
		const lifecycleLayer = Layer.succeed(LifecycleExecution, lifecycle);
		const sharedDependencies = Layer.mergeAll(
			repositoriesLayer.pipe(Layer.provideMerge(recorderLayer)),
			engineLayer,
			WorkflowExecutionNotifications.layer,
			makeAppConfigLayer(),
		);
		const baseBackgroundLayer = BackgroundWorkService.layer.pipe(Layer.provide(sharedDependencies));
		const backgroundLayer = Layer.effect(
			BackgroundWorkService,
			Effect.gen(function* () {
				const background = yield* BackgroundWorkService;
				const session = yield* DatabaseSession;
				return {
					...background,
					lockAccount: (account: Parameters<typeof background.lockAccount>[0]) =>
						Effect.gen(function* () {
							yield* recorder.record({
								operation: "lockAccount",
								inTransaction: yield* session.isTransactionActive,
							});
							return yield* background.lockAccount(account);
						}),
				};
			}),
		).pipe(Layer.provide(Layer.merge(baseBackgroundLayer, sharedDependencies)));
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
					backgroundLayer,
					projectionRepositoryLayer.pipe(Layer.provide(sharedDependencies)),
					projectionBindingsLayer,
				),
			),
			Layer.provide(redisLayer),
		);
		const controlsLayer = Layer.succeed(StreamWorkControls, {
			workflowCalls: Ref.get(workflowCalls),
			processorCalls: Ref.get(processorCalls),
			admissionCalls: Ref.get(admissionCalls),
			setProcessor: (id, action) =>
				Ref.update(actions, (current) => new Map(current).set(id, action)),
			failProjectionFor: (streamId) =>
				Ref.update(failedProjectionStreams, (current) => new Set(current).add(streamId)),
			clearProjectionFailureFor: (streamId) =>
				Ref.update(failedProjectionStreams, (current) => {
					const next = new Set(current);
					next.delete(streamId);
					return next;
				}),
			runProcessor: (streamId, input, jobId) =>
				Effect.gen(function* () {
					yield* Ref.update(processorCalls, (calls) => [...calls, { jobId, id: streamId }]);
					const action = (yield* Ref.get(actions)).get(streamId);
					if (!action) {
						return yield* new DbError({
							message: "No event stream processor action was configured",
						});
					}
					return yield* action(input, jobId);
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

const EventStreamFeatureInput = Schema.Struct({ id: Schema.String });

const process = (job: BackgroundWorkInput) =>
	Effect.gen(function* () {
		const controls = yield* StreamWorkControls;
		const service = yield* EventStreamWorkService;
		const feature = yield* Schema.decodeUnknownEffect(EventStreamFeatureInput)(job.featureInput);
		const input = yield* Schema.decodeUnknownEffect(EventStreamStepInput)(job.execution.input);
		const output = yield* controls.runProcessor(feature.id, input, job.id);
		const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, job.id);
		return yield* service
			.process(job, output)
			.pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
	});

const processCurrent = (streamId: string) =>
	Effect.gen(function* () {
		const streams = yield* EventStreamRepository;
		const background = yield* BackgroundWorkService;
		const stream = yield* streams.get(streamId);
		assert(stream?.currentJobId);
		const job = yield* background.start(stream.currentJobId);
		assert(job);
		yield* process(job);
		return job;
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

const backgroundJob = (id: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const [job] = yield* session.run((db) =>
			db
				.select({ error: tables.backgroundWork.error, status: tables.backgroundWork.status })
				.from(tables.backgroundWork)
				.where(eq(tables.backgroundWork.id, id)),
		);
		return job ?? null;
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

	test.effect("publishes a page, settles its job, and admits a fresh continuation", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const background = yield* BackgroundWorkService;
			const { id, eventId } = yield* seedStream("page");
			const sourceBefore = yield* sourceState(eventId);
			assert(sourceBefore);
			const before = yield* streams.get(id);
			assert(before?.currentJobId);
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 9, "next-page")));

			const job = yield* processCurrent(id);
			expect(job.purpose).toBe("event-projection");
			expect(job.execution.subject.type).toBe("projection");
			expect(job.id).toBe(before.currentJobId);
			expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });

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
			expect(checkpointed.completedRevision).toBeNull();
			expect(checkpointed.step).toBe(before.step + 1);
			assert(checkpointed.currentJobId);
			expect(checkpointed.currentJobId).not.toBe(job.id);
			yield* background.dispatch(checkpointed.currentJobId);
			const nextJob = yield* background.start(checkpointed.currentJobId);
			assert(nextJob);
			expect(nextJob.execution.subject.type).toBe("projection");
			expect(
				(yield* Schema.decodeUnknownEffect(EventStreamStepInput)(nextJob.execution.input))
					.checkpoint,
			).toEqual({ cursor: "next-page" });
			expect((yield* controls.processorCalls)[0]).toEqual({ id, jobId: job.id });
		}),
	);

	test.effect("advances a multi-step stream to done through scope handoff", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const background = yield* BackgroundWorkService;
			const { id, eventId } = yield* seedStream("multi-step");
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 5, "second")));
			const first = yield* processCurrent(id);
			const continued = yield* streams.get(id);
			assert(continued?.currentJobId);
			expect(yield* backgroundJob(continued.currentJobId)).toEqual({
				error: null,
				status: "queued",
			});

			yield* background.dispatch(first.id);
			expect(yield* backgroundJob(continued.currentJobId)).toEqual({
				error: null,
				status: "running",
			});

			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 6, "last"), done: true }),
			);
			const last = yield* processCurrent(id);
			expect(last.id).toBe(continued.currentJobId);
			const finished = yield* streams.get(id);
			expect(finished?.status).toBe("succeeded");
			expect(yield* projection(eventId)).toEqual({ properties: { score: 6 } });
			expect(yield* backgroundJob(last.id)).toEqual({ error: null, status: "succeeded" });
		}),
	);

	test.effect("rolls back a failed projection publication and retries the page", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const { id, eventId } = yield* seedStream("retry");
			const sourceBefore = yield* sourceState(eventId);
			assert(sourceBefore);
			yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 8, "retry-page")));
			const before = yield* streams.get(id);
			assert(before?.currentJobId);
			yield* controls.failProjectionFor(id);

			assertExitFails(
				yield* Effect.exit(processCurrent(id)),
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
			expect(pending.currentJobId).toBe(before.currentJobId);
			expect(pending.step).toBe(before.step);
			expect(yield* backgroundJob(before.currentJobId)).toEqual({ error: null, status: "running" });

			yield* controls.clearProjectionFailureFor(id);
			const retried = yield* processCurrent(id);
			expect(retried.id).toBe(before.currentJobId);
			expect(yield* backgroundJob(retried.id)).toEqual({ error: null, status: "succeeded" });

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
			expect(finished.status).toBe("queued");
			expect(finished.currentJobId).not.toBe(retried.id);
		}),
	);

	test.effect("dispatches coalesced stream steps independently of ambient workflow parents", () =>
		Effect.gen(function* () {
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const { id } = yield* seedStream("parent-independent");
			const streams = yield* EventStreamRepository;
			const stream = yield* streams.get(id);
			assert(stream?.currentJobId);
			const workflowCallsBefore = yield* controls.workflowCalls;
			const parentA = WorkflowInstance.initial(BackgroundWorkWorkflow, "stream-parent-a");
			const parentB = WorkflowInstance.initial(BackgroundWorkWorkflow, "stream-parent-b");
			yield* background
				.dispatch(stream.currentJobId)
				.pipe(Effect.provideService(WorkflowInstance, parentA));
			yield* background
				.dispatch(stream.currentJobId)
				.pipe(Effect.provideService(WorkflowInstance, parentB));

			const dispatches = (yield* controls.workflowCalls).slice(workflowCallsBefore.length);
			expect(dispatches).toHaveLength(2);
			expect(dispatches.map(({ parentExecutionId }) => parentExecutionId)).toEqual([null, null]);
			expect(dispatches.map(({ executionId }) => executionId)).toEqual([
				stream.currentJobId,
				stream.currentJobId,
			]);
		}),
	);

	test.effect(
		"keeps a settled job replay from duplicating a committed projection or continuation",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const { id, eventId } = yield* seedStream("replay");
				const sourceBefore = yield* sourceState(eventId);
				assert(sourceBefore);
				const controlsBefore = yield* controls.processorCalls;
				yield* controls.setProcessor(id, () => Effect.succeed(page(eventId, 7, "replay-page")));

				const job = yield* processCurrent(id);
				const afterFirst = yield* streams.get(id);
				assert(afterFirst?.currentJobId);
				yield* process(job);
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
				expect(work.currentJobId).toBe(afterFirst.currentJobId);
				expect(work.streamRevision).toBe(afterFirst.streamRevision);
				expect(work.completedRevision).toBeNull();
				expect((yield* controls.processorCalls).slice(controlsBefore.length)).toEqual([
					{ id, jobId: job.id },
					{ id, jobId: job.id },
				]);
			}),
	);

	test.effect(
		"rejects foreign events, undeclared properties, duplicate IDs, oversized pages, and malformed output",
		() =>
			Effect.gen(function* () {
				const controls = yield* StreamWorkControls;
				const { id, eventId } = yield* seedStream("invalid-output");
				const foreign = yield* seedStream("foreign-output");
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
					assertExitFails(yield* Effect.exit(processCurrent(id)), new DbError({ message }));
				}
			}),
	);

	test.effect(
		"does not commit a processor result after an ordinary source edit invalidates its claim",
		() =>
			Effect.gen(function* () {
				const events = yield* EventsRepository;
				const eventService = yield* EventsService;
				const streams = yield* EventStreamRepository;
				const controls = yield* StreamWorkControls;
				const { id, eventId } = yield* seedStream("concurrent-edit");
				const before = yield* streams.get(id);
				assert(before);
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

				const job = yield* processCurrent(id);

				const source = yield* events.getEventSnapshot({ userId, eventId });
				assert(source);
				expect(source.snapshot.properties).toEqual({ rating: 2 });
				const work = yield* streams.get(id);
				assert(work);
				expect(work.status).toBe("queued");
				expect(work.checkpoint).toBeNull();
				expect(work.streamRevision).toBeGreaterThan(before.streamRevision);
				expect(work.currentJobId).not.toBe(job.id);
			}),
	);

	test.effect("does not commit a stale processor result after its source event is deleted", () =>
		Effect.gen(function* () {
			const eventService = yield* EventsService;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			const { id, eventId } = yield* seedStream("deleted-source");
			const before = yield* streams.get(id);
			assert(before);
			yield* controls.setProcessor(id, () =>
				Effect.gen(function* () {
					yield* eventService.delete({ userId, eventId }, command("delete-stream-source"));
					return { done: false, updates: [], checkpoint: { cursor: "deleted" } };
				}),
			);

			const job = yield* processCurrent(id);

			expect(yield* events.getEventSnapshot({ userId, eventId })).toBeNull();
			const work = yield* streams.get(id);
			assert(work);
			expect(work.status).toBe("queued");
			expect(work.checkpoint).toBeNull();
			expect(work.streamRevision).toBeGreaterThan(before.streamRevision);
			expect(work.currentJobId).not.toBe(job.id);
		}),
	);

	test.effect(
		"rejects output from an old configuration binding and admits the current processor",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const bindings = yield* ProjectionBindingControl;
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const { id, eventId, fixture } = yield* seedStream("configuration-change");
				const [configuration] = yield* session.run((db) =>
					db
						.select()
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, fixture.pluginPin.configRevisionId)),
				);
				assert(configuration);
				const nextPin = {
					...fixture.pluginPin,
					configRevisionId: PluginConfigRevisionId.make(`${configuration.id}-rebound`),
				};
				yield* session.run((db) =>
					db
						.insert(tables.pluginConfigRevision)
						.values({ ...configuration, id: nextPin.configRevisionId }),
				);
				yield* controls.setProcessor(id, () =>
					bindings
						.set({
							pluginPin: nextPin,
							accountGeneration: fixture.accountGeneration,
							principal: { ...fixture.principal, pluginRevision: nextPin },
						})
						.pipe(Effect.as({ ...page(eventId, 9, "old-binding"), done: true })),
				);
				const oldJob = yield* processCurrent(id);
				expect(yield* projection(eventId)).toBeNull();
				expect(yield* backgroundJob(oldJob.id)).toEqual({ error: null, status: "succeeded" });
				const rebound = yield* streams.get(id);
				assert(rebound?.currentJobId);
				expect(rebound.currentJobId).not.toBe(oldJob.id);
				expect(rebound).toMatchObject({
					status: "queued",
					checkpoint: null,
					completedRevision: null,
				});
				expect(rebound.pluginPin).toMatchObject({ configRevisionId: nextPin.configRevisionId });
				yield* bindings.set({
					pluginPin: fixture.pluginPin,
					principal: fixture.principal,
					accountGeneration: fixture.accountGeneration,
				});
			}),
	);

	test.effect(
		"continues reconciliation after a failed admission and rotates it behind healthy work",
		() =>
			Effect.gen(function* () {
				const service = yield* EventStreamWorkService;
				const background = yield* BackgroundWorkService;
				const streams = yield* EventStreamRepository;
				const controls = yield* StreamWorkControls;
				const session = yield* DatabaseSession;
				const failed = yield* seedStream("reconcile-unavailable-processor");
				const healthy = yield* seedStream("reconcile-healthy-processor");
				const failedBefore = yield* streams.get(failed.id);
				const healthyBefore = yield* streams.get(healthy.id);
				assert(failedBefore?.currentJobId);
				assert(healthyBefore?.currentJobId);
				const healthyBeforeJobId = healthyBefore.currentJobId;

				const restoreRows = Effect.gen(function* () {
					yield* session.run((db) =>
						db
							.update(tables.eventStreamWork)
							.set({
								step: failedBefore.step,
								updatedAt: failedBefore.updatedAt,
								currentJobId: failedBefore.currentJobId,
								processorScriptId: failedBefore.processorScriptId,
							})
							.where(eq(tables.eventStreamWork.id, failed.id)),
					);
					yield* session.run((db) =>
						db
							.update(tables.eventStreamWork)
							.set({
								step: healthyBefore.step,
								updatedAt: healthyBefore.updatedAt,
								currentJobId: healthyBefore.currentJobId,
								processorScriptId: healthyBefore.processorScriptId,
							})
							.where(eq(tables.eventStreamWork.id, healthy.id)),
					);
				});
				const beforeAdmissionCalls = yield* controls.admissionCalls;
				const beforeWorkflowCalls = yield* controls.workflowCalls;
				const reconciliation = Effect.gen(function* () {
					yield* background.finish(healthyBeforeJobId, "succeeded");
					yield* session.run((db) =>
						db
							.update(tables.eventStreamWork)
							.set({
								currentJobId: null,
								updatedAt: new Date(-2000),
								processorScriptId: SandboxScriptId.make("missing-stream-processor"),
							})
							.where(eq(tables.eventStreamWork.id, failed.id)),
					);
					yield* session.run((db) =>
						db
							.update(tables.eventStreamWork)
							.set({ currentJobId: null, updatedAt: new Date(-1000) })
							.where(eq(tables.eventStreamWork.id, healthy.id)),
					);
					yield* service.reconcile();

					const failedAfter = yield* streams.get(failed.id);
					const healthyAfter = yield* streams.get(healthy.id);
					assert(failedAfter);
					assert(healthyAfter?.currentJobId);
					expect(failedAfter.currentJobId).toBeNull();
					expect(failedAfter.processorScriptId).toBe("missing-stream-processor");
					expect(failedAfter.updatedAt.getTime()).toBeGreaterThan(healthyAfter.updatedAt.getTime());
					expect(yield* backgroundJob(healthyAfter.currentJobId)).toEqual({
						error: null,
						status: "running",
					});

					const admissionCalls = (yield* controls.admissionCalls).slice(
						beforeAdmissionCalls.length,
					);
					for (const id of [failed.id, healthy.id]) {
						const index = admissionCalls.findIndex(
							(call) => call.operation === "prepare" && call.id === id,
						);
						expect(index).toBeGreaterThan(0);
						expect(admissionCalls[index - 1]).toEqual({
							inTransaction: true,
							operation: "lockAccount",
						});
						expect(admissionCalls[index]).toEqual({
							id,
							inTransaction: true,
							operation: "prepare",
						});
					}
					const dispatches = (yield* controls.workflowCalls)
						.slice(beforeWorkflowCalls.length)
						.filter((call) => call.executionId === healthyAfter.currentJobId);
					expect(dispatches).toHaveLength(1);
					expect(dispatches[0]).toMatchObject({
						inTransaction: false,
						name: BackgroundWorkWorkflow._tag,
						executionId: healthyAfter.currentJobId,
						payload: { id: healthyAfter.currentJobId },
					});
				});

				yield* reconciliation.pipe(Effect.ensuring(restoreRows.pipe(Effect.orDie)));
			}),
	);

	test.effect("blocks dispatch after an account generation is retired", () =>
		Effect.gen(function* () {
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const session = yield* DatabaseSession;
			const { id } = yield* seedStream("retired-account");
			const stream = yield* streams.get(id);
			assert(stream?.currentJobId);
			const workflowCallsBefore = yield* controls.workflowCalls;
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "retired-generation" })
					.where(eq(tables.user.id, userId)),
			);

			assertExitFails(
				yield* Effect.exit(background.dispatch(stream.currentJobId)),
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
});
