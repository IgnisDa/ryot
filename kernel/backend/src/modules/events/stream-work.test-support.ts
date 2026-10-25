import { assert } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EventStreamStepInput } from "@ryot-app/contract/modules/events/stream-work";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationExecutionId,
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginId,
	type SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Option, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ProjectionFinalizerLive } from "#boot/projection-finalizer";
import { LifecycleServicesLive } from "#modules/automations/layer";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { BackgroundWorkInput } from "#modules/background-work/model";
import { BackgroundWorkExecutor } from "#modules/background-work/model";
import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { runBackgroundWorkWorkflow } from "#modules/background-work/workflow";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventMutations } from "#modules/events/mutations";
import { EventProjectionRepository } from "#modules/events/projection-repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { eventStreamId, EventStreamRepository } from "#modules/events/stream-repository";
import { EventStreamLifecycleWorkLive, EventStreamWorkService } from "#modules/events/stream-work";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipProjectionRepository } from "#modules/relationships/projections/repository";
import { RelationshipProjectionService } from "#modules/relationships/projections/service";
import { RyotQLService } from "#modules/ryotql/service";
import {
	ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import {
	ProjectionBindings,
	ProjectionBindingsLive,
} from "#modules/scripts/executions/projection-bindings";
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

export const userId = UserId.make("owner");
export const accountToken = "test-account-generation";
export const entitySchemaSlug = "fixture-record";
export const eventSchemaSlug = EventSchemaSlug.make("record-set");
export const adjustmentSchemaSlug = EventSchemaSlug.make("record-adjustment");
export const coordinationSchemaSlug = EventSchemaSlug.make("record-coordination");
export const summarySchemaSlug = EventSchemaSlug.make("record-summary");
export const processorScriptSlug = "stream-fixture-processor";
export const eventSchema = {
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
		inputs: [
			{ eventSchemaSlug, scope: "entity" },
			{ scope: "entity", eventSchemaSlug: coordinationSchemaSlug },
			{ scope: "entity", eventSchemaSlug: adjustmentSchemaSlug },
			{ scope: { property: "subject" }, eventSchemaSlug: adjustmentSchemaSlug },
		],
	},
} satisfies PluginManifest["entitySchemas"][number]["eventSchemas"][number];
export const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"));
const isoOccurredAt = "2026-10-05T00:00:00.000Z";

export const fixturePackage = (): NormalizedPlugin => {
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
				eventSchemas: [
					eventSchema,
					{
						name: "Summary",
						slug: summarySchemaSlug,
						propertiesSchema: { fields: {} },
						projection: {
							scriptSlug: processorScriptSlug,
							propertiesSchema: eventSchema.projection.propertiesSchema,
							inputs: [
								{ scope: "entity", eventSchemaSlug: summarySchemaSlug },
								{ scope: "entity", eventSchemaSlug: coordinationSchemaSlug },
							],
						},
					},
					{
						name: "Coordination",
						slug: coordinationSchemaSlug,
						propertiesSchema: {
							fields: { value: { type: "number", label: "Value", description: "Recorded value" } },
						},
					},
					{
						name: "Adjustment",
						slug: adjustmentSchemaSlug,
						propertiesSchema: {
							fields: {
								value: { type: "number", label: "Value", description: "Recorded value" },
								subject: {
									type: "string",
									label: "Subject",
									description: "Related entity",
									reference: { kind: "entity-id" },
								},
							},
						},
					},
				],
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
>()("@ryot-app/kernel-backend/modules/events/stream-work.test-support/StreamWorkRecorder") {}

export class ProjectionBindingControl extends Context.Service<
	ProjectionBindingControl,
	{ set: (binding: null | undefined | ProjectionBinding) => Effect.Effect<void> }
>()("@ryot-app/kernel-backend/modules/events/stream-work.test-support/ProjectionBindingControl") {}

export class StreamWorkFixture extends Context.Service<
	StreamWorkFixture,
	{
		pluginId: PluginId;
		pluginPin: ScriptPluginRevision;
		processorScriptId: SandboxScriptId;
		principal: ScriptExecutionPrincipal;
		entitySchemaSlug: typeof entitySchemaSlug;
		accountGeneration: { token: string; userId: UserId };
	}
>()("@ryot-app/kernel-backend/modules/events/stream-work.test-support/StreamWorkFixture") {}

export class StreamWorkControls extends Context.Service<
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
>()("@ryot-app/kernel-backend/modules/events/stream-work.test-support/StreamWorkControls") {}

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
).pipe(Layer.provideMerge(makeRevisionDatabaseLayer(4)));

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
		const bindings = yield* ProjectionBindings;
		const current = yield* Ref.make<null | undefined | ProjectionBinding>(undefined);
		return Layer.merge(
			Layer.succeed(ProjectionBindings, {
				resolve: (input) =>
					Effect.gen(function* () {
						const binding = yield* Ref.get(current);
						return binding === undefined ? yield* bindings.resolve(input) : binding;
					}),
			}),
			Layer.succeed(ProjectionBindingControl, { set: (binding) => Ref.set(current, binding) }),
		);
	}),
).pipe(Layer.provideMerge(ProjectionBindingsLive.pipe(Layer.provideMerge(fixtureLayer))));

export const streamWorkTestLayer = Layer.unwrap(
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
		const sharedDependencies = Layer.mergeAll(
			repositoriesLayer.pipe(Layer.provideMerge(recorderLayer)),
			engineLayer,
			WorkflowExecutionNotifications.layer,
			makeAppConfigLayer(),
			Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(0) })),
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
		const serviceLayer = Layer.mergeAll(
			EventStreamWorkService.layer,
			RelationshipProjectionService.layer,
			RyotQLService.layer,
		).pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					sharedDependencies,
					backgroundLayer,
					projectionRepositoryLayer.pipe(Layer.provide(sharedDependencies)),
					projectionBindingsLayer,
					RelationshipProjectionRepository.layer.pipe(Layer.provide(sharedDependencies)),
					RelationshipSchemaReaderLive.pipe(Layer.provide(sharedDependencies)),
				),
			),
		);
		const lifecycleWorkLayer = EventStreamLifecycleWorkLive.pipe(
			Layer.provide(Layer.merge(serviceLayer, backgroundLayer)),
		);
		const lifecycleLayer = LifecycleServicesLive.pipe(
			Layer.provide(lifecycleWorkLayer),
			Layer.provide(sharedDependencies),
		);
		const eventsServiceLayer = Layer.merge(EventsService.layer, EventMutations.layer).pipe(
			Layer.provideMerge(Layer.merge(sharedDependencies, lifecycleLayer)),
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
		return Layer.mergeAll(
			serviceLayer,
			eventsServiceLayer,
			controlsLayer,
			ProjectionFinalizerLive.pipe(Layer.provide(serviceLayer)),
		);
	}),
);

export const command = (id: string) => ({
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

export const seedStream = (suffix: string, schemaSlug = eventSchemaSlug) =>
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
				properties: { rating: 1 },
				eventSchemaSlug: schemaSlug,
				eventSchemaName: eventSchema.name,
				eventSchemaPluginId: fixture.pluginId,
			}),
		);
		const id = yield* service.request({
			pluginPin: fixture.pluginPin,
			accountGeneration: fixture.accountGeneration,
			processorScriptId: fixture.processorScriptId,
			request: { entityId, eventSchemaSlug: schemaSlug },
			command: { ...command(`request-${suffix}`), writeContext: fixture.principal },
		});
		return { id, eventId, fixture, entityId };
	});

export const page = (eventId: EventId, rating: number, cursor: string) => ({
	done: false,
	checkpoint: { cursor },
	updates: [{ eventId, properties: { score: rating } }],
});

export const seedAdjustment = (input: {
	id: string;
	entityId: EntityId;
	subject?: EntityId;
	sessionEntityId?: EntityId;
}) =>
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		const session = yield* DatabaseSession;
		const events = yield* EventsRepository;
		return yield* session.transaction(
			events.createEvent({
				userId,
				occurredAt,
				entityId: input.entityId,
				id: EventId.make(input.id),
				eventSchemaName: "Adjustment",
				eventSchemaSlug: adjustmentSchemaSlug,
				eventSchemaPluginId: fixture.pluginId,
				sessionEntityId: input.sessionEntityId,
				properties: {
					value: 1,
					...(input.subject === undefined ? {} : { subject: input.subject }),
				},
			}),
		);
	});

export const seedRetainedTargets = (suffix: string, count: number) =>
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		const session = yield* DatabaseSession;
		const holder = EntityId.make(`000-${suffix}-holder`);
		const children = Array.from({ length: count }, (_, index) =>
			EntityId.make(`000-${suffix}-child-${String(index).padStart(3, "0")}`),
		);
		const eventId = EventId.make(`${suffix}-output`);
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values(
					[holder, ...children].map((id) => ({
						id,
						userId,
						name: id,
						entitySchemaSlug,
						entitySchemaPluginId: fixture.pluginId,
					})),
				),
		);
		yield* session.run((db) =>
			db.insert(tables.event).values([
				{
					userId,
					occurredAt,
					id: eventId,
					eventSchemaSlug,
					entityId: holder,
					properties: { rating: 1 },
					eventSchemaPluginId: fixture.pluginId,
				},
				{
					userId,
					occurredAt,
					entityId: holder,
					id: `${suffix}-input`,
					sessionEntityId: holder,
					eventSchemaSlug: adjustmentSchemaSlug,
					eventSchemaPluginId: fixture.pluginId,
					properties: { value: 2, subject: holder },
				},
			]),
		);
		const key = {
			userId,
			eventSchemaSlug,
			entityId: holder,
			eventSchemaPluginId: fixture.pluginId,
		};
		return { key, holder, fixture, eventId, children, id: eventStreamId(key) };
	});

const EventStreamFeatureInput = Schema.Struct({ id: Schema.String });

export const process = (job: BackgroundWorkInput) =>
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

export const currentJob = (streamId: string) =>
	Effect.gen(function* () {
		const streams = yield* EventStreamRepository;
		const background = yield* BackgroundWorkService;
		const stream = yield* streams.get(streamId);
		assert(stream?.currentJobId);
		const job = yield* background.start(stream.currentJobId);
		assert(job);
		return job;
	});

export const processCurrent = (streamId: string) =>
	Effect.gen(function* () {
		const job = yield* currentJob(streamId);
		yield* process(job);
		return job;
	});

export const sourceState = (eventId: EventId) =>
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

export const projection = (eventId: EventId) =>
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

export const backgroundJob = (id: string) =>
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

export const runBackgroundJob = (
	id: string,
	execute: BackgroundWorkExecutor["Service"]["execute"],
) => {
	const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, id);
	return runBackgroundWorkWorkflow({ id }).pipe(
		Effect.provideService(BackgroundWorkExecutor, { execute }),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
	);
};
