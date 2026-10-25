import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EventStreamStepInput } from "@ryot-app/contract/modules/events/stream-work";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { RelationshipProjectionStepInput } from "@ryot-app/contract/modules/relationships/projections";
import {
	AutomationExecutionId,
	EntityId,
	EventId,
	EventSchemaSlug,
	PluginConfigRevisionId,
	PluginId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import {
	ascending,
	column,
	eq as queryEq,
	field,
	literal,
	rows as queryRows,
	table,
} from "@ryot-app/ryotql";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { objectContaining } from "@ryot-app/testing/matchers";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
	Context,
	DateTime,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Ref,
	Schema,
} from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ProjectionFinalizerLive, ProjectionRecoveryLive } from "#boot/projection-finalizer";
import { LifecycleServicesLive } from "#modules/automations/layer";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import type { BackgroundWorkInput } from "#modules/background-work/model";
import {
	BackgroundWorkExecutor,
	ProjectionBindings,
	ProjectionInputReadiness,
} from "#modules/background-work/model";
import { BackgroundWorkService, BackgroundWorkWorkflow } from "#modules/background-work/service";
import { runBackgroundWorkWorkflow } from "#modules/background-work/workflow";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { RelationshipSchemaReaderLive } from "#modules/definitions/layer";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventMutations, eventPolicyItems } from "#modules/events/mutations";
import {
	projectionDependencyTargets,
	projectionSources,
} from "#modules/events/projection-dependencies";
import { EventProjectionInputReadinessLive } from "#modules/events/projection-readiness";
import { EventProjectionRepository } from "#modules/events/projection-repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import {
	eventStreamId,
	EventStreamRepository,
	type StreamKey,
} from "#modules/events/stream-repository";
import {
	EventStreamInputRepairClaim,
	eventStreamInputRepairJobId,
	EventStreamLifecycleWorkLive,
	EventStreamWorkService,
} from "#modules/events/stream-work";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { fixtureManifest, testPluginPackageId } from "#modules/plugins/test-support";
import {
	RelationshipProjectionInputFenceLive,
	RelationshipProjectionRepository,
} from "#modules/relationships/projections/repository";
import { RelationshipProjectionService } from "#modules/relationships/projections/service";
import { RyotQLService } from "#modules/ryotql/service";
import {
	ScriptExecutionPrincipal,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { ProjectionBindingsLive } from "#modules/scripts/executions/projection-bindings";
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
const adjustmentSchemaSlug = EventSchemaSlug.make("record-adjustment");
const dependencySchemaSlug = EventSchemaSlug.make("record-dependency");
const coordinationSchemaSlug = EventSchemaSlug.make("record-coordination");
const summarySchemaSlug = EventSchemaSlug.make("record-summary");
const repairSchemaSlug = EventSchemaSlug.make("repair-record");
const siblingRepairSchemaSlug = EventSchemaSlug.make("repair-summary");
const lateRepairSchemaSlug = EventSchemaSlug.make("repair-late");
const processorScriptSlug = "stream-fixture-processor";
const relationshipSchemaSlug = RelationshipSchemaSlug.make("fixture-summary");
const eventSchema = {
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
			{ eventSchemaSlug, scope: "session" },
			{ scope: "entity", eventSchemaSlug: coordinationSchemaSlug },
			{ scope: "entity", eventSchemaSlug: adjustmentSchemaSlug },
			{ scope: "session", eventSchemaSlug: adjustmentSchemaSlug },
			{ scope: { property: "subject" }, eventSchemaSlug: adjustmentSchemaSlug },
			{
				scope: "entity",
				eventSchemaSlug: adjustmentSchemaSlug,
				through: {
					targetProperty: "child",
					sourceProperty: "parent",
					eventSchemaSlug: dependencySchemaSlug,
				},
			},
			{
				scope: "session",
				eventSchemaSlug: adjustmentSchemaSlug,
				through: {
					targetProperty: "child",
					sourceProperty: "parent",
					eventSchemaSlug: dependencySchemaSlug,
				},
			},
			{
				scope: { property: "subject" },
				eventSchemaSlug: adjustmentSchemaSlug,
				through: {
					targetProperty: "child",
					sourceProperty: "parent",
					eventSchemaSlug: dependencySchemaSlug,
				},
			},
		],
	},
} satisfies PluginManifest["entitySchemas"][number]["eventSchemas"][number];
const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-05T00:00:00.000Z"));
const isoOccurredAt = "2026-10-05T00:00:00.000Z";

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
	const beforeScript = {
		...emptySandboxExecutionMetadata,
		kind: "automation" as const,
		slug: "fixture.repair-policy",
		name: "Validate repair writes",
		automationType: "policy" as const,
		entry: "backend/repair-policy.sandbox.ts",
		inputProjection: { event: { properties: ["rating"] } },
	};
	const afterScript = {
		...beforeScript,
		slug: "fixture.repair-after",
		name: "Observe ordinary writes",
		automationType: "automation" as const,
		entry: "backend/repair-after.sandbox.ts",
		inputProjection: { event: { compareProperties: [], properties: ["rating"] } },
	};
	const manifest: PluginManifest = {
		...fixture,
		workflows: [],
		providers: [],
		signalSchemas: [],
		metadata: { ...fixture.metadata },
		scripts: [{ ...script, entry }, beforeScript, afterScript],
		relationshipSchemas: [
			{
				name: "Fixture summary",
				slug: relationshipSchemaSlug,
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: null,
				propertiesSchema: { fields: {} },
				projection: {
					scriptSlug: processorScriptSlug,
					propertiesSchema: eventSchema.projection.propertiesSchema,
				},
			},
		],
		hooks: [
			{
				stage: "before",
				slug: "repair-policy",
				name: "Validate writes",
				scriptSlug: beforeScript.slug,
				targets: [
					{
						entitySchemaSlug,
						resource: "event",
						operation: "update",
						eventSchemaSlug: repairSchemaSlug,
					},
				],
			},
			{
				stage: "after",
				delivery: "async",
				slug: "repair-after",
				name: "Observe writes",
				scriptSlug: afterScript.slug,
				targets: [
					{
						entitySchemaSlug,
						resource: "event",
						operation: "update",
						eventSchemaSlug: repairSchemaSlug,
					},
				],
			},
		],
		entitySchemas: [
			{
				...entitySchema,
				slug: entitySchemaSlug,
				name: "Fixture record",
				eventSchemas: [
					eventSchema,
					{
						...eventSchema,
						slug: repairSchemaSlug,
						projection: {
							...eventSchema.projection,
							inputRepairScriptSlug: processorScriptSlug,
							inputs: [{ scope: "entity", eventSchemaSlug: repairSchemaSlug }],
						},
					},
					...[siblingRepairSchemaSlug, lateRepairSchemaSlug].map(
						(slug): PluginManifest["entitySchemas"][number]["eventSchemas"][number] =>
							Object.assign({}, eventSchema, {
								slug,
								projection: {
									...eventSchema.projection,
									inputRepairScriptSlug: processorScriptSlug,
									inputs: [{ eventSchemaSlug: slug, scope: "entity" as const }],
								},
							}),
					),
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
					{ name: "Unrelated", slug: "unrelated", propertiesSchema: { fields: {} } },
					{
						name: "Dependency",
						slug: dependencySchemaSlug,
						propertiesSchema: {
							fields: {
								child: {
									type: "string",
									label: "Child",
									description: "Output reference",
									reference: { kind: "entity-id" },
								},
								parent: {
									type: "string",
									label: "Parent",
									description: "Input reference",
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
			...[beforeScript, afterScript].map(({ entry: compiledEntry, ...metadata }) => ({
				metadata,
				compiledFormat: 1,
				name: metadata.name,
				slug: metadata.slug,
				entry: compiledEntry,
				compiledCode: metadata.slug,
				contentHash: `${metadata.slug}-hash`,
			})),
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
	{ beforeDiscovery: Effect.Effect<void>; record: (call: StreamWorkCall) => Effect.Effect<void> }
>()("test/StreamWorkRecorder") {}

class ProjectionBindingControl extends Context.Service<
	ProjectionBindingControl,
	{ set: (binding: null | undefined | ProjectionBinding) => Effect.Effect<void> }
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
		policyCalls: Effect.Effect<ReadonlyArray<string>>;
		failProjectionFor: (streamId: string) => Effect.Effect<void>;
		admissionCalls: Effect.Effect<ReadonlyArray<StreamWorkCall>>;
		clearProjectionFailureFor: (streamId: string) => Effect.Effect<void>;
		setBeforeDiscovery: (before: Effect.Effect<void>) => Effect.Effect<void>;
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
			discover: (keys: Parameters<typeof repository.discover>[0]) =>
				recorder.beforeDiscovery.pipe(Effect.andThen(repository.discover(keys))),
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
		const policyCalls = yield* Ref.make<ReadonlyArray<string>>([]);
		const beforeDiscovery = yield* Ref.make<Effect.Effect<void>>(Effect.void);
		const recorder = {
			beforeDiscovery: Ref.get(beforeDiscovery).pipe(Effect.flatten),
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
					RelationshipProjectionInputFenceLive.pipe(Layer.provide(sharedDependencies)),
					RelationshipProjectionRepository.layer.pipe(Layer.provide(sharedDependencies)),
					RelationshipSchemaReaderLive.pipe(Layer.provide(sharedDependencies)),
				),
			),
			Layer.provideMerge(EventProjectionInputReadinessLive.pipe(Layer.provide(sharedDependencies))),
			Layer.provide(redisLayer),
		);
		const lifecycleWorkLayer = EventStreamLifecycleWorkLive.pipe(
			Layer.provide(Layer.merge(serviceLayer, backgroundLayer)),
			Layer.provide(RelationshipProjectionInputFenceLive.pipe(Layer.provide(sharedDependencies))),
		);
		const lifecycleLayer = LifecycleServicesLive.pipe(
			Layer.provide(lifecycleWorkLayer),
			Layer.provide(sharedDependencies),
		);
		const policyExecutionLayer = Layer.effect(
			LifecycleExecution,
			Effect.gen(function* () {
				const execution = yield* LifecycleExecution;
				return {
					...execution,
					executePolicy: (input: Parameters<typeof execution.executePolicy>[0]) =>
						Ref.update(policyCalls, (calls) => [...calls, input.runId]).pipe(
							Effect.as({ action: "allow" as const }),
						),
				};
			}),
		).pipe(Layer.provide(lifecycleLayer));
		const eventsServiceLayer = Layer.merge(EventsService.layer, EventMutations.layer).pipe(
			Layer.provide(policyExecutionLayer),
			Layer.provideMerge(Layer.merge(sharedDependencies, lifecycleLayer)),
			Layer.provide(redisLayer),
		);
		const controlsLayer = Layer.succeed(StreamWorkControls, {
			policyCalls: Ref.get(policyCalls),
			workflowCalls: Ref.get(workflowCalls),
			processorCalls: Ref.get(processorCalls),
			admissionCalls: Ref.get(admissionCalls),
			setBeforeDiscovery: (before) => Ref.set(beforeDiscovery, before),
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

const seedStream = (suffix: string, schemaSlug = eventSchemaSlug) =>
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

const page = (eventId: EventId, rating: number, cursor: string) => ({
	done: false,
	checkpoint: { cursor },
	updates: [{ eventId, properties: { score: rating } }],
});

const seedAdjustment = (input: {
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

const waitingOutput = { done: false, updates: [], checkpoint: null, waitingForInputs: true };

const dependencyInput = (
	fixture: StreamWorkFixture["Service"],
	input: { id: string; child: EntityId; parent: EntityId; entityId: EntityId },
) => ({
	userId,
	occurredAt,
	entityId: input.entityId,
	id: EventId.make(input.id),
	eventSchemaName: "Dependency",
	eventSchemaSlug: dependencySchemaSlug,
	eventSchemaPluginId: fixture.pluginId,
	properties: { child: input.child, parent: input.parent },
});

const seedRetainedDependencyTargets = (suffix: string, count: number) =>
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
			db
				.insert(tables.event)
				.values([
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
					...children.map((child) =>
						dependencyInput(fixture, {
							child,
							parent: holder,
							entityId: holder,
							id: `${suffix}-edge-${child}`,
						}),
					),
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

const currentJob = (streamId: string) =>
	Effect.gen(function* () {
		const streams = yield* EventStreamRepository;
		const background = yield* BackgroundWorkService;
		const stream = yield* streams.get(streamId);
		assert(stream?.currentJobId);
		const job = yield* background.start(stream.currentJobId);
		assert(job);
		return job;
	});

const claimInputRepair = (source: Effect.Success<ReturnType<typeof seedStream>>) =>
	Effect.gen(function* () {
		const streams = yield* EventStreamRepository;
		const background = yield* BackgroundWorkService;
		const work = yield* streams.get(source.id);
		assert(work?.inputRepairJobId);
		const job = yield* background.start(work.inputRepairJobId);
		assert(job);
		const claim = yield* Schema.decodeUnknownEffect(EventStreamInputRepairClaim)(job.featureInput);
		expect(job.id).toBe(eventStreamInputRepairJobId(claim));
		expect(job.execution.subject).toEqual({
			userId,
			type: "user",
			afterHooks: "skip",
			accountGeneration: source.fixture.accountGeneration,
		});
		return job;
	});

const processCurrent = (streamId: string) =>
	Effect.gen(function* () {
		const job = yield* currentJob(streamId);
		yield* process(job);
		return job;
	});

const processInputRepair = (job: BackgroundWorkInput, output: unknown) =>
	Effect.gen(function* () {
		const service = yield* EventStreamWorkService;
		const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, job.id);
		return yield* service
			.processInputRepair(job, output)
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

const seedRelationshipSummary = (entityId: EntityId) =>
	Effect.gen(function* () {
		const fixture = yield* StreamWorkFixture;
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.relationship)
				.values({
					userId,
					relationshipSchemaSlug,
					sourceEntityId: entityId,
					targetEntityId: entityId,
					id: `summary-${entityId}`,
					relationshipSchemaPluginId: fixture.pluginId,
				}),
		);
		return yield* (yield* RelationshipProjectionService).request({
			pluginPin: fixture.pluginPin,
			accountGeneration: fixture.accountGeneration,
			request: { relationshipSchemaSlug, sourceEntityIds: [entityId] },
			command: { ...command(`summary-${entityId}`), writeContext: fixture.principal },
		});
	});

const relationshipNote = (entityId: EntityId) =>
	Effect.gen(function* () {
		const [note] = yield* (yield* DatabaseSession).run((db) =>
			db
				.select()
				.from(tables.relationshipProjection)
				.where(eq(tables.relationshipProjection.relationshipId, `summary-${entityId}`)),
		);
		return note ?? null;
	});

const summaryRead = (entityId: EntityId) =>
	Effect.gen(function* () {
		const source = table("relationship", "summary");
		const result = yield* (yield* RyotQLService).executeForUser(userId, null, "kernel", {
			queries: {
				summary: queryRows(source, {
					orderBy: [ascending(column(source, "id"))],
					where: queryEq(column(source, "id"), literal(`summary-${entityId}`)),
					fields: [
						field("projection", column(source, "projection")),
						field("status", column(source, "projectionStatus")),
					],
				}),
			},
		});
		return result.data["summary"];
	});

const currentSummaryJob = (id: string) =>
	Effect.gen(function* () {
		const work = yield* (yield* RelationshipProjectionRepository).get(id);
		assert(work?.currentJobId);
		yield* (yield* BackgroundWorkService).dispatch(work.currentJobId);
		const job = yield* (yield* BackgroundWorkService).start(work.currentJobId);
		assert(job);
		return job;
	});

const publishSummary = (job: BackgroundWorkInput, score: number) =>
	Effect.gen(function* () {
		const input = yield* Schema.decodeUnknownEffect(RelationshipProjectionStepInput)(
			job.execution.input,
		);
		const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, job.id);
		yield* (yield* RelationshipProjectionService)
			.process(job, {
				updates: input.relationships.map(({ relationshipId }) => ({
					relationshipId,
					properties: { score },
				})),
			})
			.pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
	});

const completeStream = (id: string) =>
	Effect.gen(function* () {
		const streams = yield* EventStreamRepository;
		const background = yield* BackgroundWorkService;
		const session = yield* DatabaseSession;
		for (;;) {
			const work = yield* streams.get(id);
			assert(work);
			if (work.completedRevision === work.streamRevision) {
				return;
			}
			assert(work.currentJobId);
			yield* background.dispatch(work.currentJobId);
			const [running] = yield* session.run((db) =>
				db
					.select({ id: tables.eventStreamWork.id })
					.from(tables.eventStreamWork)
					.innerJoin(
						tables.backgroundWork,
						eq(tables.backgroundWork.id, tables.eventStreamWork.currentJobId),
					)
					.where(
						and(
							eq(tables.backgroundWork.status, "running"),
							eq(tables.backgroundWork.purpose, "event-projection"),
							eq(tables.backgroundWork.userId, work.key.userId),
							eq(tables.backgroundWork.scope, work.key.entityId),
							sql`${tables.backgroundWork.pluginId} is not distinct from ${work.key.eventSchemaPluginId}`,
						),
					)
					.limit(1),
			);
			assert(running);
			yield* (yield* StreamWorkControls).setProcessor(running.id, () =>
				Effect.succeed({ done: true, updates: [], checkpoint: null }),
			);
			yield* processCurrent(running.id);
		}
	});

const requestRepair = (
	source: Effect.Success<ReturnType<typeof seedStream>>,
	slug = repairSchemaSlug,
) =>
	Effect.gen(function* () {
		return yield* (yield* EventStreamWorkService).request({
			pluginPin: source.fixture.pluginPin,
			accountGeneration: source.fixture.accountGeneration,
			processorScriptId: source.fixture.processorScriptId,
			request: { eventSchemaSlug: slug, entityId: source.entityId },
			command: {
				...command(`repair-${source.entityId}-${slug}`),
				writeContext: source.fixture.principal,
			},
		});
	});

const readySummary = (suffix: string) =>
	Effect.gen(function* () {
		const source = yield* seedStream(suffix);
		yield* completeStream(source.id);
		const workId = yield* seedRelationshipSummary(source.entityId);
		yield* publishSummary(yield* currentSummaryJob(workId), 1);
		const note = yield* relationshipNote(source.entityId);
		assert(note);
		return { note, source, workId };
	});

const runBackgroundJob = (id: string, execute: BackgroundWorkExecutor["Service"]["execute"]) => {
	const instance = WorkflowInstance.initial(BackgroundWorkWorkflow, id);
	return runBackgroundWorkWorkflow({ id }).pipe(
		Effect.provideService(BackgroundWorkExecutor, { execute }),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
	);
};

const runSettlingJob = (job: BackgroundWorkInput, output: unknown) =>
	runBackgroundJob(job.id, () => Effect.succeed(output));

const admitSilentDescendant = (root: BackgroundWorkInput, suffix: string) =>
	Effect.gen(function* () {
		const id = `silent-descendant-${suffix}`;
		const job = {
			...root,
			id,
			key: id,
			featureInput: null,
			execution: { ...root.execution, input: null, executionId: `${id}-script` },
		};
		yield* (yield* DatabaseSession).transaction((yield* BackgroundWorkService).admit(job));
		return job;
	});

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"fences every relationship processor in the execution account across plugin ownership",
		() =>
			Effect.gen(function* () {
				const { source, workId } = yield* readySummary("relationship-cross-plugin");
				const other = fixturePackage();
				const installed = yield* installRevisionPackage(
					{
						...other,
						contentHash: "other-relationship-processor",
						manifest: {
							...other.manifest,
							metadata: { ...other.manifest.metadata, packageId: testPluginPackageId() },
						},
					},
					null,
				);
				const pluginId = PluginId.make(installed.pluginId);
				const binding = yield* (yield* ProjectionBindings).resolve({
					userId,
					pluginId,
					scriptSlug: processorScriptSlug,
				});
				assert(binding);
				const entityId = EntityId.make("other-plugin-summary");
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId,
							id: entityId,
							entitySchemaSlug,
							name: "Other record",
							entitySchemaPluginId: pluginId,
						}),
				);
				yield* session.run((db) =>
					db
						.insert(tables.relationship)
						.values({
							userId,
							relationshipSchemaSlug,
							sourceEntityId: entityId,
							targetEntityId: entityId,
							id: `summary-${entityId}`,
							relationshipSchemaPluginId: pluginId,
						}),
				);
				const relationships = yield* RelationshipProjectionService;
				const otherWorkId = yield* relationships.request({
					pluginPin: binding.pluginPin,
					accountGeneration: binding.accountGeneration,
					request: { relationshipSchemaSlug, sourceEntityIds: [entityId] },
					command: { ...command("other-plugin-summary"), writeContext: binding.principal },
				});
				yield* publishSummary(yield* currentSummaryJob(otherWorkId), 2);
				expect(yield* summaryRead(entityId)).toMatchObject({
					items: [{ status: "ready", projection: { score: 2 } }],
				});
				const repairId = yield* requestRepair(source);
				const repository = yield* RelationshipProjectionRepository;
				expect((yield* repository.get(workId))?.inputRepairRevision).toBe(1);
				expect((yield* repository.get(otherWorkId))?.inputRepairRevision).toBe(1);
				expect(yield* summaryRead(entityId)).toMatchObject({
					items: [{ projection: null, status: "pending" }],
				});
				yield* processInputRepair(yield* claimInputRepair({ ...source, id: repairId }), null);
				yield* completeStream(repairId);
				yield* relationships.reconcile(userId);
				expect((yield* relationshipNote(source.entityId))?.revision).toBe(2);
				expect((yield* relationshipNote(entityId))?.revision).toBe(2);
			}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect("keeps failed repair roots closed even with retained completed stream evidence", () =>
		Effect.gen(function* () {
			const source = yield* seedStream("relationship-failed-root", repairSchemaSlug);
			const root = yield* claimInputRepair(source);
			const workId = yield* seedRelationshipSummary(source.entityId);
			const streams = yield* EventStreamRepository;
			const work = yield* streams.get(source.id);
			assert(work);
			yield* (yield* BackgroundWorkService).finish(root.id, "failed", "Repair failed");
			yield* (yield* DatabaseSession).run((db) =>
				db
					.update(tables.eventStreamWork)
					.set({ completedRevision: work.streamRevision })
					.where(eq(tables.eventStreamWork.id, source.id)),
			);
			expect(yield* (yield* ProjectionInputReadiness).ready(source.fixture.accountGeneration)).toBe(
				false,
			);
			yield* (yield* EventStreamWorkService).reconcile();
			yield* (yield* RelationshipProjectionService).reconcile(userId);
			expect(
				(yield* (yield* RelationshipProjectionRepository).get(workId))?.currentJobId,
			).toBeNull();
			expect((yield* backgroundJob(root.id))?.status).toBe("failed");
		}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"requires the exact current repair epoch, processor pin, installation and enabled account",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("relationship-current-root", repairSchemaSlug);
				const root = yield* claimInputRepair(source);
				yield* processInputRepair(root, null);
				yield* completeStream(source.id);
				const session = yield* DatabaseSession;
				const readiness = yield* ProjectionInputReadiness;
				const work = yield* (yield* EventStreamRepository).get(source.id);
				assert(work);
				expect(yield* readiness.ready(source.fixture.accountGeneration)).toBe(true);
				yield* session.run((db) =>
					db
						.update(tables.eventStream)
						.set({ repairEpoch: "another-epoch" })
						.where(eq(tables.eventStream.id, source.id)),
				);
				expect(yield* readiness.ready(source.fixture.accountGeneration)).toBe(false);
				yield* session.run((db) =>
					db
						.update(tables.eventStream)
						.set({ repairEpoch: work.repairEpoch })
						.where(eq(tables.eventStream.id, source.id)),
				);
				yield* session.run((db) =>
					db
						.update(tables.eventStreamWork)
						.set({ pluginPin: { configRevisionId: "stale" } })
						.where(eq(tables.eventStreamWork.id, source.id)),
				);
				expect(yield* readiness.ready(source.fixture.accountGeneration)).toBe(false);
				yield* session.run((db) =>
					db
						.update(tables.eventStreamWork)
						.set({ pluginPin: work.pluginPin })
						.where(eq(tables.eventStreamWork.id, source.id)),
				);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ health: "needs-configuration" })
						.where(eq(tables.pluginInstallation.pluginId, source.fixture.pluginId)),
				);
				expect(yield* readiness.ready(source.fixture.accountGeneration)).toBe(false);
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ health: "ready" })
						.where(eq(tables.pluginInstallation.pluginId, source.fixture.pluginId)),
				);
				const summaryId = yield* seedRelationshipSummary(source.entityId);
				yield* publishSummary(yield* currentSummaryJob(summaryId), 1);
				yield* session.run((db) =>
					db.update(tables.user).set({ disabledAt: occurredAt }).where(eq(tables.user.id, userId)),
				);
				expect(yield* readiness.ready(source.fixture.accountGeneration)).toBe(false);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ projection: null, status: "pending" }],
				});
				yield* session.run((db) =>
					db.update(tables.user).set({ disabledAt: null }).where(eq(tables.user.id, userId)),
				);
				expect(yield* readiness.ready({ userId, token: "retired" })).toBe(false);
			}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"hides ready relationship notes at root admission and prepares many shared roots once per completed wave",
		() =>
			Effect.gen(function* () {
				const { note, source, workId } = yield* readySummary("relationship-wave");
				const relationships = yield* RelationshipProjectionService;
				const repository = yield* RelationshipProjectionRepository;
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ status: "ready", projection: { score: 1 } }],
				});
				const repairId = yield* requestRepair(source);
				const root = yield* claimInputRepair({ ...source, id: repairId });
				expect(yield* relationshipNote(source.entityId)).toEqual(note);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ projection: null, status: "pending" }],
				});
				const firstGeneration = (yield* repository.get(workId))?.inputRepairRevision;
				const siblingId = yield* requestRepair(source, siblingRepairSchemaSlug);
				expect((yield* repository.get(workId))?.inputRepairRevision).toBe(firstGeneration);
				const other = yield* seedStream("relationship-other-root", repairSchemaSlug);
				const otherRoot = yield* claimInputRepair(other);
				yield* processInputRepair(root, null);
				yield* completeStream(repairId);
				yield* completeStream(siblingId);
				yield* relationships.reconcile(userId);
				expect(yield* relationshipNote(source.entityId)).toEqual(note);
				expect((yield* repository.get(workId))?.currentJobId).toBeNull();
				yield* processInputRepair(otherRoot, null);
				yield* completeStream(other.id);
				yield* relationships.reconcile(userId);
				const prepared = yield* repository.get(workId);
				assert(prepared?.currentJobId);
				expect(prepared.inputRepairRevision).toBe((firstGeneration ?? 0) + 1);
				expect(prepared.preparedInputRepairRevision).toBe(prepared.inputRepairRevision);
				expect((yield* relationshipNote(source.entityId))?.revision).toBe(note.revision + 1);
				yield* relationships.reconcile(userId);
				yield* (yield* EventStreamWorkService).inputRepairCompleted(otherRoot);
				yield* relationships.reconcile(userId);
				expect((yield* relationshipNote(source.entityId))?.revision).toBe(note.revision + 1);
				yield* publishSummary(yield* currentSummaryJob(workId), 2);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ status: "ready", projection: { score: 2 } }],
				});
			}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"rejects a relationship publication after a late committed silent descendant write",
		() =>
			Effect.gen(function* () {
				const { source, workId } = yield* readySummary("relationship-late-write");
				const repairId = yield* requestRepair(source);
				const root = yield* claimInputRepair({ ...source, id: repairId });
				yield* processInputRepair(root, null);
				yield* completeStream(repairId);
				yield* (yield* RelationshipProjectionService).reconcile(userId);
				const stale = yield* currentSummaryJob(workId);
				const before = yield* relationshipNote(source.entityId);
				yield* (yield* EventsService).edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
					userId,
					{
						...command("late-descendant-write"),
						writeContext: { ...source.fixture.principal, subject: root.execution.subject },
					},
				);
				yield* publishSummary(stale, 99);
				expect(yield* backgroundJob(stale.id)).toEqual({ error: null, status: "succeeded" });
				expect(yield* relationshipNote(source.entityId)).toEqual(before);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ projection: null, status: "pending" }],
				});
				yield* completeStream(source.id);
				yield* (yield* RelationshipProjectionService).reconcile(userId);
				yield* publishSummary(yield* currentSummaryJob(workId), 3);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ status: "ready", projection: { score: 3 } }],
				});
			}),
	);
});

for (const recovery of ["settlement", "startup"]) {
	layer(streamWorkTestLayer)((test) => {
		test.effect(
			`waits for retained silent descendants and releases relationship work through ${recovery} without cron`,
			() =>
				Effect.gen(function* () {
					const { note, source, workId } = yield* readySummary(`relationship-${recovery}`);
					const repairId = yield* requestRepair(source);
					const root = yield* claimInputRepair({ ...source, id: repairId });
					const descendant = yield* admitSilentDescendant(root, recovery);
					yield* processInputRepair(root, null);
					yield* completeStream(repairId);
					const relationships = yield* RelationshipProjectionService;
					const repository = yield* RelationshipProjectionRepository;
					yield* relationships.reconcile(userId);
					expect((yield* repository.get(workId))?.currentJobId).toBeNull();
					expect(yield* relationshipNote(source.entityId)).toEqual(note);
					expect(
						yield* (yield* ProjectionInputReadiness).ready(source.fixture.accountGeneration),
					).toBe(false);
					const background = yield* BackgroundWorkService;
					yield* background.dispatch(descendant.id);
					if (recovery === "settlement") {
						yield* runSettlingJob(descendant, null);
					} else {
						yield* background.finish(descendant.id, "succeeded");
						expect((yield* repository.get(workId))?.currentJobId).toBeNull();
						yield* Effect.scoped(Layer.build(ProjectionRecoveryLive));
					}
					expect((yield* repository.get(workId))?.currentJobId).not.toBeNull();
					expect((yield* relationshipNote(source.entityId))?.revision).toBe(note.revision + 1);
					yield* relationships.reconcile(userId);
					expect((yield* relationshipNote(source.entityId))?.revision).toBe(note.revision + 1);
				}),
		);
	});
}

for (const inputs of ["input-only", "mapping-only"]) {
	layer(streamWorkTestLayer)((test) => {
		test.effect(
			`keeps missing and unbound ${inputs} targets pending until current event processing completes`,
			() =>
				Effect.gen(function* () {
					const retained = yield* seedRetainedDependencyTargets(`relationship-${inputs}`, 1);
					const session = yield* DatabaseSession;
					const readiness = yield* ProjectionInputReadiness;
					const child = retained.children[0];
					assert(child);
					yield* session.run((db) =>
						db
							.delete(tables.event)
							.where(
								inArray(
									tables.event.id,
									inputs === "mapping-only"
										? [retained.eventId, EventId.make(`relationship-${inputs}-input`)]
										: [retained.eventId, EventId.make(`relationship-${inputs}-edge-${child}`)],
								),
							),
					);
					expect(yield* readiness.ready(retained.fixture.accountGeneration)).toBe(false);
					const entityId = inputs === "mapping-only" ? child : retained.holder;
					const id = eventStreamId({ ...retained.key, entityId });
					yield* session.run((db) =>
						db.insert(tables.eventStream).values({ ...retained.key, id, entityId }),
					);
					expect(yield* readiness.ready(retained.fixture.accountGeneration)).toBe(false);
					yield* (yield* EventStreamWorkService).reconcile();
					expect(yield* readiness.ready(retained.fixture.accountGeneration)).toBe(false);
					yield* completeStream(id);
					expect(yield* readiness.ready(retained.fixture.accountGeneration)).toBe(true);
					yield* session.run((db) =>
						db
							.update(tables.eventStreamWork)
							.set({ accountToken: "retired" })
							.where(eq(tables.eventStreamWork.id, id)),
					);
					expect(yield* readiness.ready(retained.fixture.accountGeneration)).toBe(false);
				}),
		);
	});
}

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"fences relationship output with atomic restore and resumes normal work without cron",
		() =>
			Effect.gen(function* () {
				const { note, source, workId } = yield* readySummary("relationship-restore");
				const session = yield* DatabaseSession;
				const restore = yield* BackupRestorePersistence.make;
				const repository = yield* RelationshipProjectionRepository;
				const before = yield* repository.get(workId);
				assert(before);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(
							Effect.gen(function* () {
								yield* restore.fenceEventStreamInputs(userId, "relationship-restore");
								return yield* new DbError({ message: "Restore rolled back" });
							}),
						),
					),
					new DbError({ message: "Restore rolled back" }),
				);
				expect(yield* repository.get(workId)).toEqual(before);
				expect(yield* relationshipNote(source.entityId)).toEqual(note);
				yield* session.transaction(restore.fenceEventStreamInputs(userId, "relationship-restore"));
				expect((yield* repository.get(workId))?.inputRepairRevision).toBe(
					before.inputRepairRevision + 1,
				);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ projection: null, status: "pending" }],
				});
				yield* Effect.scoped(Layer.build(ProjectionRecoveryLive));
				const eventJob = yield* currentJob(source.id);
				yield* runSettlingJob(eventJob, { done: true, updates: [], checkpoint: null });
				expect((yield* repository.get(workId))?.currentJobId).not.toBeNull();
				expect((yield* relationshipNote(source.entityId))?.revision).toBe(note.revision + 1);
				yield* publishSummary(yield* currentSummaryJob(workId), 4);
				expect(yield* summaryRead(source.entityId)).toMatchObject({
					items: [{ status: "ready", projection: { score: 4 } }],
				});
			}),
	);
});

layer(streamWorkTestLayer)((test) => {
	test.effect(
		"keeps policies, validation, and projection admission for trusted repair writes while skipping after hooks",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("repair-writes", repairSchemaSlug);
				const root = yield* claimInputRepair(source);
				const service = yield* EventStreamWorkService;
				const background = yield* BackgroundWorkService;
				const events = yield* EventsService;
				const streams = yield* EventStreamRepository;
				const session = yield* DatabaseSession;
				const controls = yield* StreamWorkControls;
				const principal = { ...source.fixture.principal, subject: root.execution.subject };
				const summaryId = yield* seedRelationshipSummary(source.entityId);
				const summaries = yield* RelationshipProjectionRepository;
				const generation = (yield* summaries.get(summaryId))?.inputRepairRevision;
				assert(generation !== undefined);
				yield* background.finish(root.id, "succeeded");
				yield* service.inputRepairCompleted(root);
				const before = yield* streams.get(source.id);
				const calls = (yield* controls.policyCalls).length;
				const repairCommand = { ...command("trusted-repair-write"), writeContext: principal };
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
					userId,
					repairCommand,
				);
				expect((yield* summaries.get(summaryId))?.inputRepairRevision).toBe(generation + 1);
				expect((yield* controls.policyCalls).length).toBe(calls + 1);
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
					userId,
					repairCommand,
				);
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
					userId,
					{ ...command("unchanged-repair-write"), writeContext: principal },
				);
				expect((yield* summaries.get(summaryId))?.inputRepairRevision).toBe(generation + 1);
				const runs = yield* session.run((db) =>
					db
						.select({ stage: tables.automationRun.stage })
						.from(tables.automationRun)
						.innerJoin(
							tables.automationTrigger,
							eq(tables.automationTrigger.id, tables.automationRun.triggerId),
						)
						.where(eq(tables.automationTrigger.executionId, repairCommand.causation.executionId)),
				);
				expect(runs.map(({ stage }) => stage)).toEqual(["before"]);
				const admitted = yield* streams.get(source.id);
				assert(admitted?.currentJobId);
				expect(admitted.currentJobId).not.toBe(before?.currentJobId);
				const projectionJobId = admitted.currentJobId;
				const [projectionJob] = yield* session.run((db) =>
					db
						.select({ purpose: tables.backgroundWork.purpose })
						.from(tables.backgroundWork)
						.where(eq(tables.backgroundWork.id, projectionJobId)),
				);
				expect(projectionJob?.purpose).toBe("event-projection");
				const retained = yield* sourceState(source.eventId);
				assert(
					Exit.isFailure(
						yield* Effect.exit(
							events.edit(
								{
									eventId: source.eventId,
									patch: { properties: { remove: [], set: { rating: "invalid" } } },
								},
								userId,
								{ ...command("invalid-repair-write"), writeContext: principal },
							),
						),
					),
				);
				expect(yield* sourceState(source.eventId)).toEqual(retained);
				expect((yield* streams.get(source.id))?.streamRevision).toBe(admitted.streamRevision);
				const ordinary = {
					...command("ordinary-repair-schema-write"),
					writeContext: source.fixture.principal,
				};
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 3 } } } },
					userId,
					ordinary,
				);
				const normalRuns = yield* session.run((db) =>
					db
						.select({ stage: tables.automationRun.stage })
						.from(tables.automationRun)
						.innerJoin(
							tables.automationTrigger,
							eq(tables.automationTrigger.id, tables.automationRun.triggerId),
						)
						.where(eq(tables.automationTrigger.executionId, ordinary.causation.executionId)),
				);
				expect(normalRuns.map(({ stage }) => stage).sort()).toEqual(["after", "before"]);
				expect((yield* summaries.get(summaryId))?.inputRepairRevision).toBe(generation + 1);
			}),
	);

	test.effect(
		"coalesces entity streams and reuses succeeded repair for a newly discovered ordinary schema",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("repair-coalescing", repairSchemaSlug);
				const root = yield* claimInputRepair(source);
				const service = yield* EventStreamWorkService;
				const streams = yield* EventStreamRepository;
				const background = yield* BackgroundWorkService;
				const summaryId = yield* seedRelationshipSummary(source.entityId);
				const summaries = yield* RelationshipProjectionRepository;
				const generation = (yield* summaries.get(summaryId))?.inputRepairRevision;
				const request = (slug: EventSchemaSlug) =>
					service.request({
						pluginPin: source.fixture.pluginPin,
						accountGeneration: source.fixture.accountGeneration,
						processorScriptId: source.fixture.processorScriptId,
						request: { eventSchemaSlug: slug, entityId: source.entityId },
						command: {
							...command(`repair-sibling-${slug}`),
							writeContext: source.fixture.principal,
						},
					});
				const siblings = yield* Effect.all(
					[request(siblingRepairSchemaSlug), request(siblingRepairSchemaSlug)],
					{ concurrency: 2 },
				);
				const sibling = siblings[0];
				expect(siblings[1]).toBe(sibling);
				expect((yield* streams.get(sibling))?.inputRepairJobId).toBe(root.id);
				expect((yield* streams.get(sibling))?.currentJobId).toBeNull();
				yield* background.finish(root.id, "succeeded");
				yield* service.inputRepairCompleted(root);
				expect((yield* streams.get(sibling))?.currentJobId).not.toBeNull();
				const late = yield* request(lateRepairSchemaSlug);
				expect((yield* streams.get(late))?.inputRepairJobId).toBe(root.id);
				expect((yield* streams.get(late))?.repairEpoch).toBe(
					(yield* streams.get(source.id))?.repairEpoch,
				);
				expect((yield* streams.get(late))?.currentJobId).not.toBeNull();
				expect(yield* backgroundJob(root.id)).toEqual({ error: null, status: "succeeded" });
				expect((yield* summaries.get(summaryId))?.inputRepairRevision).toBe(generation);
			}),
	);
	test.effect("recovers committed dispatch claims beyond the first hundred background scopes", () =>
		Effect.gen(function* () {
			const { fixture } = yield* seedStream("recovery-scopes");
			const background = yield* BackgroundWorkService;
			const session = yield* DatabaseSession;
			const controls = yield* StreamWorkControls;
			const ids = Array.from({ length: 101 }, (_, index) => `recovery-scope-${index}`);
			yield* session.transaction(
				Effect.gen(function* () {
					yield* background.lockAccount(fixture.accountGeneration);
					for (const id of ids) {
						yield* background.admit({
							id,
							key: id,
							scope: id,
							featureInput: null,
							purpose: "user-script",
							contentHash: fixture.principal.contentHash,
							accountGeneration: fixture.accountGeneration,
							execution: {
								input: null,
								lane: "background",
								resolutionMode: "exact",
								executionId: `${id}-script`,
								pluginRevision: fixture.pluginPin,
								scriptId: fixture.processorScriptId,
								subject: { userId, type: "user", accountGeneration: fixture.accountGeneration },
							},
						});
					}
				}),
			);
			const calls = (yield* controls.workflowCalls).length;
			yield* background.recover();
			const dispatched = (yield* controls.workflowCalls)
				.slice(calls)
				.filter(({ executionId }) => ids.includes(executionId));
			expect(new Set(dispatched.map(({ executionId }) => executionId))).toEqual(new Set(ids));
			expect(dispatched.every(({ inTransaction }) => !inTransaction)).toBe(true);
			const jobs = yield* session.run((db) =>
				db
					.select({ status: tables.backgroundWork.status })
					.from(tables.backgroundWork)
					.where(inArray(tables.backgroundWork.id, ids)),
			);
			expect(jobs).toHaveLength(101);
			expect(jobs.every(({ status }) => status === "running")).toBe(true);
		}),
	);
	test.effect(
		"gates the first projection on the claimed repair root, not retained marker values",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("companion-gate", repairSchemaSlug);
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				expect((yield* streams.get(source.id))?.currentJobId).toBeNull();
				const root = yield* claimInputRepair(source);
				expect((yield* streams.listCandidates(100)).some(({ id }) => id === source.id)).toBe(false);
				yield* service.reconcile();
				expect((yield* streams.get(source.id))?.currentJobId).toBeNull();
				yield* processInputRepair(root, null);
				const admitted = yield* streams.get(source.id);
				assert(admitted?.currentJobId);
				expect(admitted.inputRepairJobId).toBe(root.id);
				expect(admitted.completedRevision).toBeNull();
				yield* controls.setProcessor(source.id, () => Effect.succeed(waitingOutput));
				yield* processCurrent(source.id);
				expect((yield* streams.get(source.id))?.completedRevision).toBeNull();
				expect((yield* streams.get(source.id))?.inputRepairJobId).toBe(root.id);
			}),
	);

	test.effect(
		"does not reuse a succeeded input repair on a restored bootstrap entity with the same binding",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("restored-repair-root", repairSchemaSlug);
				const original = yield* claimInputRepair(source);
				yield* processInputRepair(original, null);
				const session = yield* DatabaseSession;
				const restore = yield* BackupRestorePersistence.make;
				const service = yield* EventStreamWorkService;
				const streams = yield* EventStreamRepository;
				yield* session.transaction(
					restore.fenceEventStreamInputs(userId, "bootstrap-repair-restore"),
				);
				yield* service.request({
					pluginPin: source.fixture.pluginPin,
					accountGeneration: source.fixture.accountGeneration,
					processorScriptId: source.fixture.processorScriptId,
					request: { entityId: source.entityId, eventSchemaSlug: repairSchemaSlug },
					command: {
						...command("restored-repair-binding"),
						writeContext: source.fixture.principal,
					},
				});
				const current = yield* claimInputRepair(source);
				expect(current.id).not.toBe(original.id);
				expect(current.execution.pluginRevision).toEqual(original.execution.pluginRevision);
				expect((yield* streams.get(source.id))?.currentJobId).toBeNull();
				expect((yield* streams.get(source.id))?.repairEpoch).toBe(
					"restore:bootstrap-repair-restore",
				);
				yield* session.transaction(
					restore.fenceEventStreamInputs(userId, "bootstrap-repair-restore"),
				);
				expect((yield* streams.get(source.id))?.inputRepairJobId).toBe(current.id);
			}),
	);

	test.effect("keeps failed input repair pending without admitting a projection", () =>
		Effect.gen(function* () {
			const source = yield* seedStream("companion-failed", repairSchemaSlug);
			const streams = yield* EventStreamRepository;
			const service = yield* EventStreamWorkService;
			const background = yield* BackgroundWorkService;
			const root = yield* claimInputRepair(source);
			assertExitFails(
				yield* Effect.exit(processInputRepair(root, { ready: true })),
				new DbError({ message: "Event stream input repair must return null" }),
			);
			yield* background.finish(root.id, "failed", "Repair unavailable");
			yield* service.inputRepairCompleted(root);
			yield* service.reconcile();
			expect((yield* streams.get(source.id))?.currentJobId).toBeNull();
			expect((yield* streams.get(source.id))?.completedRevision).toBeNull();
		}),
	);

	test.effect(
		"fences reused bootstrap streams atomically and joins new schemas to the restored epoch",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("restore-epoch");
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const restore = yield* BackupRestorePersistence.make;
				const before = yield* streams.get(source.id);
				assert(before?.currentJobId);
				yield* session.transaction(streams.claimInputRepair(source.id, before.currentJobId));
				const facts = yield* sourceState(source.eventId);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(
							Effect.gen(function* () {
								yield* restore.fenceEventStreamInputs(userId, "restore-run");
								return yield* new DbError({ message: "Restore rolled back" });
							}),
						),
					),
					new DbError({ message: "Restore rolled back" }),
				);
				expect((yield* streams.get(source.id))?.repairEpoch).toBe(before.repairEpoch);
				expect((yield* streams.get(source.id))?.inputRepairJobId).toBe(before.currentJobId);
				yield* session.transaction(restore.fenceEventStreamInputs(userId, "restore-run"));
				const fenced = yield* streams.get(source.id);
				assert(fenced);
				expect(fenced.repairEpoch).toBe("restore:restore-run");
				expect(fenced.streamRevision).toBe(before.streamRevision + 1);
				expect(fenced.currentJobId).toBeNull();
				expect(fenced.inputRepairJobId).toBeNull();
				expect(fenced.completedRevision).toBeNull();
				yield* session.transaction(restore.fenceEventStreamInputs(userId, "restore-run"));
				expect((yield* streams.get(source.id))?.streamRevision).toBe(fenced.streamRevision);
				expect(yield* sourceState(source.eventId)).toEqual(facts);
				const sibling = yield* session.transaction(
					streams.request({
						accountToken,
						processorScriptId: source.fixture.processorScriptId,
						pluginRevisionId: source.fixture.pluginPin.revisionId,
						outputSchema: eventSchema.projection.propertiesSchema,
						pluginPin: yield* Schema.encodeUnknownEffect(JsonValue)({
							...source.fixture.pluginPin,
							writeContext: source.fixture.principal,
						}),
						key: {
							userId,
							entityId: source.entityId,
							eventSchemaSlug: summarySchemaSlug,
							eventSchemaPluginId: source.fixture.pluginId,
						},
					}),
				);
				expect((yield* streams.get(sibling))?.repairEpoch).toBe(fenced.repairEpoch);
				yield* seedAdjustment({ entityId: source.entityId, id: "restore-epoch-live-input" });
				expect((yield* streams.get(source.id))?.repairEpoch).toBe(fenced.repairEpoch);
			}),
	);
	test.effect("admits old and new mapped targets from ordinary input moves and deletes", () =>
		Effect.gen(function* () {
			const parent = yield* seedStream("admission-mapping-parent");
			const left = yield* seedStream("admission-mapping-left");
			const right = yield* seedStream("admission-mapping-right");
			const streams = yield* EventStreamRepository;
			const events = yield* EventsRepository;
			const eventService = yield* EventsService;
			const session = yield* DatabaseSession;
			const background = yield* BackgroundWorkService;
			const controls = yield* StreamWorkControls;
			const initial = yield* currentJob(left.id);
			const mapping = yield* session.transaction(
				events.createEvent(
					dependencyInput(left.fixture, {
						child: left.entityId,
						id: "admission-mapping",
						parent: parent.entityId,
						entityId: parent.entityId,
					}),
				),
			);
			const input = yield* seedAdjustment({
				entityId: parent.entityId,
				id: "admission-mapping-input",
			});
			for (const target of [left, right]) {
				yield* controls.setProcessor(target.id, () => Effect.succeed(waitingOutput));
			}
			yield* process(initial);
			const leftWork = yield* streams.get(left.id);
			assert(leftWork?.currentJobId);
			yield* background.dispatch(leftWork.currentJobId);
			const leftParked = yield* processCurrent(left.id);
			const rightParked = yield* processCurrent(right.id);
			yield* eventService.edit(
				{ eventId: input.id, patch: { properties: { remove: [], set: { value: 2 } } } },
				userId,
				command("admission-parent-edit"),
			);
			const leftAdmitted = yield* streams.get(left.id);
			assert(leftAdmitted?.currentJobId);
			expect(leftAdmitted.currentJobId).not.toBe(leftParked.id);
			expect((yield* streams.get(right.id))?.currentJobId).toBe(rightParked.id);
			const stale = yield* currentJob(left.id);
			yield* eventService.edit(
				{
					eventId: mapping.id,
					patch: { properties: { remove: [], set: { child: right.entityId } } },
				},
				userId,
				command("admission-mapping-move"),
			);
			const movedLeft = yield* streams.get(left.id);
			const movedRight = yield* streams.get(right.id);
			assert(movedLeft?.currentJobId);
			assert(movedRight?.currentJobId);
			expect(movedLeft.currentJobId).not.toBe(stale.id);
			expect(movedRight.currentJobId).not.toBe(rightParked.id);
			yield* controls.setProcessor(left.id, () =>
				Effect.succeed({ ...page(left.eventId, 99, "old-mapping"), done: true }),
			);
			yield* process(stale);
			expect(yield* projection(left.eventId)).toBeNull();
			yield* eventService.delete(
				{ userId, eventId: mapping.id },
				command("admission-mapping-delete"),
			);
			expect((yield* streams.get(right.id))?.currentJobId).not.toBe(movedRight.currentJobId);
			expect((yield* streams.get(right.id))?.currentJobId).not.toBeNull();
		}),
	);

	test.effect(
		"leaves optional unavailable bindings pending without rejecting their source writes",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("admission-binding-unavailable");
				const healthy = yield* seedStream("admission-binding-healthy");
				const streams = yield* EventStreamRepository;
				const bindings = yield* ProjectionBindingControl;
				const events = yield* EventsService;
				const controls = yield* StreamWorkControls;
				yield* controls.setProcessor(source.id, () => Effect.succeed(waitingOutput));
				const parked = yield* processCurrent(source.id);
				yield* bindings.set(null);
				yield* events
					.edit(
						{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
						userId,
						command("admission-unavailable-edit"),
					)
					.pipe(Effect.ensuring(bindings.set(undefined)));
				expect((yield* sourceState(source.eventId))?.properties).toEqual({ rating: 2 });
				expect((yield* streams.get(source.id))?.currentJobId).toBeNull();
				expect((yield* streams.get(source.id))?.completedRevision).toBeNull();
				expect(yield* backgroundJob(parked.id)).toEqual({ error: null, status: "succeeded" });
				const before = yield* streams.get(healthy.id);
				assert(before?.currentJobId);
				yield* events.edit(
					{ eventId: healthy.eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
					userId,
					command("admission-healthy-edit"),
				);
				expect((yield* streams.get(healthy.id))?.currentJobId).not.toBe(before.currentJobId);
				expect((yield* streams.get(healthy.id))?.currentJobId).not.toBeNull();
			}),
	);

	test.effect(
		"admits every output stream in a no-hook source batch and serializes their scope",
		() =>
			Effect.gen(function* () {
				const source = yield* seedStream("source-batch-admission");
				const session = yield* DatabaseSession;
				const events = yield* EventsRepository;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const mutations = yield* EventMutations;
				const execution = yield* LifecycleExecution;
				const background = yield* BackgroundWorkService;
				const controls = yield* StreamWorkControls;
				const summaryEventId = EventId.make("source-batch-summary");
				yield* session.transaction(
					events.createEvent({
						userId,
						occurredAt,
						properties: {},
						id: summaryEventId,
						entityId: source.entityId,
						eventSchemaName: "Summary",
						eventSchemaSlug: summarySchemaSlug,
						eventSchemaPluginId: source.fixture.pluginId,
					}),
				);
				const summaryId = yield* service.request({
					pluginPin: source.fixture.pluginPin,
					accountGeneration: source.fixture.accountGeneration,
					processorScriptId: source.fixture.processorScriptId,
					request: { entityId: source.entityId, eventSchemaSlug: summarySchemaSlug },
					command: {
						...command("source-batch-summary-request"),
						writeContext: source.fixture.principal,
					},
				});
				for (const id of [source.id, summaryId]) {
					yield* controls.setProcessor(id, () => Effect.succeed(waitingOutput));
					const work = yield* streams.get(id);
					assert(work?.currentJobId);
					yield* background.dispatch(work.currentJobId);
					yield* processCurrent(id);
				}
				const writeCommand = command("source-batch-coordination");
				const prepared = yield* session.transaction(
					mutations.prepare({
						userId,
						command: writeCommand,
						changes: [
							{
								kind: "create",
								itemIdentity: "coordination",
								item: {
									properties: { value: 1 },
									entityId: source.entityId,
									eventSchemaSlug: coordinationSchemaSlug,
								},
							},
						],
					}),
				);
				const validated = {
					triggerId: null,
					references: prepared.references,
					items: (yield* eventPolicyItems(prepared)).map((item) =>
						Object.assign({}, item, { patches: [], error: null, processed: [], rejected: null }),
					),
				};
				const callsBefore = (yield* controls.workflowCalls).length;
				const committed = yield* session.transaction(
					mutations.persist({ userId, prepared, validated, command: writeCommand }),
				);
				expect((yield* controls.workflowCalls).length).toBe(callsBefore);
				const ids = committed.dispatch.flatMap((plan) => plan.backgroundJobIds);
				expect(ids).toHaveLength(2);
				expect(committed.dispatch.flatMap((plan) => plan.runs)).toEqual([]);
				const queued = yield* session.run((db) =>
					db
						.select({
							id: tables.backgroundWork.id,
							scope: tables.backgroundWork.scope,
							status: tables.backgroundWork.status,
						})
						.from(tables.backgroundWork)
						.where(inArray(tables.backgroundWork.id, ids)),
				);
				expect(queued).toHaveLength(2);
				expect(
					queued.every((job) => job.scope === source.entityId && job.status === "queued"),
				).toBe(true);
				const replayed = yield* session.transaction(
					mutations.persist({ userId, prepared, validated, command: writeCommand }),
				);
				expect(replayed).toEqual(committed);
				yield* execution.dispatch(committed.dispatch);
				const dispatched = yield* session.run((db) =>
					db
						.select({ status: tables.backgroundWork.status })
						.from(tables.backgroundWork)
						.where(inArray(tables.backgroundWork.id, ids)),
				);
				expect(dispatched.map((job) => job.status).sort()).toEqual(["queued", "running"]);
				for (const id of [source.id, summaryId]) {
					yield* controls.setProcessor(id, () =>
						Effect.succeed({
							done: true,
							checkpoint: null,
							updates: [
								{
									properties: { score: 6 },
									eventId: id === source.id ? source.eventId : summaryEventId,
								},
							],
						}),
					);
				}
				const first = yield* session.run((db) =>
					db
						.select({ id: tables.eventStreamWork.id })
						.from(tables.eventStreamWork)
						.innerJoin(
							tables.backgroundWork,
							eq(tables.backgroundWork.id, tables.eventStreamWork.currentJobId),
						)
						.where(
							and(
								inArray(tables.backgroundWork.id, ids),
								eq(tables.backgroundWork.status, "running"),
							),
						),
				);
				assert(first[0]);
				yield* processCurrent(first[0].id);
				yield* execution.dispatch(committed.dispatch);
				const secondId = first[0].id === source.id ? summaryId : source.id;
				yield* processCurrent(secondId);
				expect(yield* projection(source.eventId)).toEqual({ properties: { score: 6 } });
				expect(yield* projection(summaryEventId)).toEqual({ properties: { score: 6 } });
			}),
	);
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
			expect((yield* controls.processorCalls).at(-1)).toEqual({ id, jobId: job.id });
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

	test.effect("retries a failed step with a new job at the same dependency revision", () =>
		Effect.gen(function* () {
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const background = yield* BackgroundWorkService;
			const streams = yield* EventStreamRepository;
			const source = yield* seedStream("failed-job-retry");
			const before = yield* streams.get(source.id);
			assert(before?.currentJobId);
			yield* background.finish(before.currentJobId, "failed", "Processor failed");
			yield* service.request({
				pluginPin: source.fixture.pluginPin,
				accountGeneration: source.fixture.accountGeneration,
				processorScriptId: source.fixture.processorScriptId,
				request: { eventSchemaSlug, entityId: source.entityId },
				command: { ...command("retry-failed-job"), writeContext: source.fixture.principal },
			});
			const retried = yield* streams.get(source.id);
			expect(retried?.currentJobId).not.toBe(before.currentJobId);
			expect(retried?.streamRevision).toBe(before.streamRevision);
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 8, "retried"), done: true }),
			);
			yield* processCurrent(source.id);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 8 } });
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
					{
						message: "Event stream checkpoint exceeds its bounded size",
						output: { done: false, updates: [], checkpoint: "界".repeat(6_000) },
					},
					{
						output: { ...waitingOutput, done: true },
						message: "Event stream processor returned invalid output",
					},
					{
						output: { ...waitingOutput, updates: repeated.updates },
						message: "Event stream processor returned invalid output",
					},
				];
				for (const { output, message } of invalidOutputs) {
					yield* controls.setProcessor(id, () => Effect.succeed(output));
					assertExitFails(yield* Effect.exit(processCurrent(id)), new DbError({ message }));
				}
			}),
	);

	test.effect("coalesces superseded queued claims and skips the outdated running processor", () =>
		Effect.gen(function* () {
			const events = yield* EventsService;
			const streams = yield* EventStreamRepository;
			const session = yield* DatabaseSession;
			const controls = yield* StreamWorkControls;
			const source = yield* seedStream("superseded-queued");
			const initial = yield* streams.get(source.id);
			assert(initial?.currentJobId);
			const jobs = [initial.currentJobId];
			for (const rating of [2, 3, 4]) {
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating } } } },
					userId,
					command(`superseded-queued-${rating}`),
				);
				const next = yield* streams.get(source.id);
				assert(next?.currentJobId);
				jobs.push(next.currentJobId);
			}
			expect(new Set(jobs).size).toBe(jobs.length);
			const latest = jobs.at(-1);
			assert(latest);
			expect(yield* backgroundJob(initial.currentJobId)).toEqual({
				error: null,
				status: "running",
			});
			for (const id of jobs.slice(1, -1)) {
				expect(yield* backgroundJob(id)).toEqual({ error: null, status: "succeeded" });
			}
			expect(yield* backgroundJob(latest)).toEqual({ error: null, status: "queued" });
			const executed: string[] = [];
			for (const id of jobs) {
				yield* runBackgroundJob(id, (job) =>
					Effect.sync(() => executed.push(job.id)).pipe(
						Effect.as({ ...page(source.eventId, 4, "current"), done: true }),
					),
				);
				expect(yield* backgroundJob(id)).toEqual({ error: null, status: "succeeded" });
				if (id !== latest) {
					expect(executed).toEqual([]);
					expect(yield* projection(source.eventId)).toBeNull();
					expect(yield* backgroundJob(latest)).toEqual({ error: null, status: "running" });
					expect((yield* controls.workflowCalls).at(-1)).toMatchObject({ executionId: latest });
				}
			}
			expect(executed).toEqual(jobs.slice(-1));
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 4 } });
			const completed = yield* streams.get(source.id);
			assert(completed);
			expect(completed.completedRevision).toBe(completed.streamRevision);
			expect(
				yield* session.run((db) =>
					db
						.select({ id: tables.sandboxWorkflowReference.executionId })
						.from(tables.sandboxWorkflowReference)
						.where(inArray(tables.sandboxWorkflowReference.executionId, jobs)),
				),
			).toEqual([]);
			const calls = (yield* controls.workflowCalls).length;
			for (const id of jobs) {
				yield* runBackgroundJob(id, () =>
					Effect.die("A settled projection must not execute again"),
				);
			}
			expect((yield* controls.workflowCalls).length).toBe(calls);
			expect(yield* streams.get(source.id)).toEqual(completed);
		}),
	);

	test.effect("preserves another stream's queued claim and reuses the current queued claim", () =>
		Effect.gen(function* () {
			const source = yield* seedStream("coalesced-sibling");
			const service = yield* EventStreamWorkService;
			const streams = yield* EventStreamRepository;
			const events = yield* EventsService;
			const binding = yield* (yield* ProjectionBindings).resolve({
				userId,
				scriptSlug: processorScriptSlug,
				pluginId: source.fixture.pluginId,
			});
			assert(binding);
			const request = {
				pluginPin: binding.pluginPin,
				accountGeneration: binding.accountGeneration,
				processorScriptId: source.fixture.processorScriptId,
				command: { ...command("coalesced-sibling-request"), writeContext: binding.principal },
			};
			const siblingId = yield* service.request({
				...request,
				request: { entityId: source.entityId, eventSchemaSlug: summarySchemaSlug },
			});
			const sibling = yield* streams.get(siblingId);
			assert(sibling?.currentJobId);
			expect(yield* backgroundJob(sibling.currentJobId)).toEqual({ error: null, status: "queued" });
			for (const rating of [2, 3]) {
				yield* events.edit(
					{ eventId: source.eventId, patch: { properties: { remove: [], set: { rating } } } },
					userId,
					command(`coalesced-sibling-edit-${rating}`),
				);
			}
			const current = yield* streams.get(source.id);
			assert(current?.currentJobId);
			yield* service.request({
				...request,
				request: { eventSchemaSlug, entityId: source.entityId },
			});
			expect((yield* streams.get(source.id))?.currentJobId).toBe(current.currentJobId);
			expect(yield* backgroundJob(current.currentJobId)).toEqual({ error: null, status: "queued" });
			expect((yield* streams.get(siblingId))?.currentJobId).toBe(sibling.currentJobId);
			expect(yield* backgroundJob(sibling.currentJobId)).toEqual({ error: null, status: "queued" });
		}),
	);

	test.effect(
		"keeps the publication fence when a source changes after projection preparation",
		() =>
			Effect.gen(function* () {
				const events = yield* EventsService;
				const streams = yield* EventStreamRepository;
				const source = yield* seedStream("prepared-then-stale");
				const job = yield* currentJob(source.id);
				const executed: string[] = [];
				yield* runBackgroundJob(job.id, (input) =>
					Effect.gen(function* () {
						executed.push(input.id);
						yield* events
							.edit(
								{
									eventId: source.eventId,
									patch: { properties: { remove: [], set: { rating: 2 } } },
								},
								userId,
								command("prepared-then-stale-edit"),
							)
							.pipe(Effect.orDie);
						return { ...page(source.eventId, 9, "stale"), done: true };
					}),
				);
				expect(executed).toEqual([job.id]);
				expect(yield* projection(source.eventId)).toBeNull();
				expect(yield* backgroundJob(job.id)).toEqual({ error: null, status: "succeeded" });
				const next = yield* streams.get(source.id);
				assert(next?.currentJobId);
				expect(next.currentJobId).not.toBe(job.id);
				expect(next.completedRevision).toBeNull();
				expect(yield* backgroundJob(next.currentJobId)).toEqual({ error: null, status: "running" });
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
						yield* eventService
							.edit(
								{ eventId, patch: { properties: { remove: [], set: { rating: 2 } } } },
								userId,
								command("ordinary-source-edit"),
							)
							.pipe(Effect.orDie);
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
					yield* eventService
						.delete({ userId, eventId }, command("delete-stream-source"))
						.pipe(Effect.orDie);
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
				yield* bindings.set(undefined);
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

	test.effect("fences sibling edits and deletions without changing the output source", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const service = yield* EventStreamWorkService;
			const events = yield* EventsService;
			const background = yield* BackgroundWorkService;
			const source = yield* seedStream("sibling-edit");
			const initial = yield* currentJob(source.id);
			const adjustment = yield* seedAdjustment({
				id: "sibling-adjustment",
				entityId: source.entityId,
			});
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 1, "old"), done: true }),
			);
			yield* process(initial);
			const queued = yield* streams.get(source.id);
			assert(queued?.currentJobId);
			yield* background.dispatch(queued.currentJobId);
			yield* processCurrent(source.id);
			const beforeSource = yield* sourceState(source.eventId);
			yield* events.edit(
				{ eventId: adjustment.id, patch: { properties: { remove: [], set: { value: 2 } } } },
				userId,
				command("sibling-edit"),
			);
			const dirty = yield* streams.get(source.id);
			expect(dirty?.checkpoint).toBeNull();
			expect(dirty?.dirtyFrom).toBeNull();
			yield* service.reconcile();
			yield* controls.setProcessor(source.id, () =>
				Effect.gen(function* () {
					yield* events
						.delete({ userId, eventId: adjustment.id }, command("sibling-delete"))
						.pipe(Effect.orDie);
					return { ...page(source.eventId, 99, "stale"), done: true };
				}),
			);
			const stale = yield* processCurrent(source.id);
			expect(yield* sourceState(source.eventId)).toEqual(beforeSource);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 1 } });
			const next = yield* streams.get(source.id);
			expect(next?.currentJobId).not.toBe(stale.id);
			expect(next?.checkpoint).toBeNull();
			expect(next?.completedRevision).not.toBe(next?.streamRevision);
		}),
	);

	test.effect("parks unfinished repair durably and wakes only for committed declared inputs", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const eventService = yield* EventsService;
			const source = yield* seedStream("waiting-input");
			const untouched = yield* seedStream("waiting-untouched");
			const initial = yield* currentJob(source.id);
			const repair = yield* seedAdjustment({ id: "waiting-ready", entityId: source.entityId });
			const sourceBefore = yield* streams.get(source.id);
			assert(sourceBefore);
			yield* controls.setProcessor(source.id, () => Effect.succeed(waitingOutput));
			yield* controls.setProcessor(untouched.id, () => Effect.succeed(waitingOutput));
			const untouchedJob = yield* processCurrent(untouched.id);
			const background = yield* BackgroundWorkService;
			yield* process(initial);
			const replacement = yield* streams.get(source.id);
			assert(replacement?.currentJobId);
			yield* background.dispatch(replacement.currentJobId);
			const parked = yield* processCurrent(source.id);
			expect(yield* backgroundJob(parked.id)).toEqual({ error: null, status: "succeeded" });
			yield* background.recover();
			yield* background.recover();
			expect((yield* streams.get(source.id))?.currentJobId).toBe(parked.id);
			expect((yield* streams.get(source.id))?.completedRevision).toBeNull();
			yield* session.transaction(
				events.createEvent({
					userId,
					occurredAt,
					properties: {},
					entityId: source.entityId,
					eventSchemaName: "Unrelated",
					id: EventId.make("waiting-unrelated"),
					eventSchemaPluginId: source.fixture.pluginId,
					eventSchemaSlug: EventSchemaSlug.make("unrelated"),
				}),
			);
			expect((yield* streams.get(source.id))?.currentJobId).toBe(parked.id);
			const rejected = yield* Effect.exit(
				session.transaction(
					Effect.gen(function* () {
						yield* events.createEvent({
							userId,
							occurredAt,
							properties: { value: 1 },
							entityId: source.entityId,
							eventSchemaName: "Adjustment",
							id: EventId.make("waiting-rollback"),
							eventSchemaSlug: adjustmentSchemaSlug,
							eventSchemaPluginId: source.fixture.pluginId,
						});
						return yield* new DbError({ message: "Rollback source write" });
					}),
				),
			);
			assertExitFails(rejected, new DbError({ message: "Rollback source write" }));
			expect((yield* streams.get(source.id))?.currentJobId).toBe(parked.id);
			const input = {
				eventId: repair.id,
				patch: { properties: { remove: [], set: { value: 2 } } },
			};
			const correction = command("waiting-ready-edit");
			const callsBefore = (yield* controls.workflowCalls).length;
			yield* eventService.edit(input, userId, correction);
			const resumed = yield* streams.get(source.id);
			assert(resumed?.currentJobId);
			expect(resumed.currentJobId).not.toBe(parked.id);
			expect(resumed.status).toBe("running");
			expect(resumed.streamRevision).toBe(sourceBefore.streamRevision + 1);
			expect(resumed.checkpoint).toBeNull();
			expect(resumed.completedRevision).toBeNull();
			expect((yield* streams.get(untouched.id))?.currentJobId).toBe(untouchedJob.id);
			expect(
				(yield* controls.workflowCalls).slice(callsBefore).every((call) => !call.inTransaction),
			).toBe(true);
			const [receipt] = yield* session.run((db) =>
				db
					.select({ dispatch: tables.mutationReceipt.dispatch })
					.from(tables.mutationReceipt)
					.where(
						and(
							eq(tables.mutationReceipt.executionId, correction.causation.executionId),
							eq(tables.mutationReceipt.receiptType, "item"),
						),
					),
			);
			expect(receipt?.dispatch).toMatchObject([
				{ runs: [], backgroundJobIds: [resumed.currentJobId] },
			]);
			yield* eventService.edit(input, userId, correction);
			expect((yield* streams.get(source.id))?.currentJobId).toBe(resumed.currentJobId);
			expect((yield* streams.get(source.id))?.step).toBe(resumed.step);
			yield* controls.setProcessor(source.id, () =>
				Effect.succeed({ ...page(source.eventId, 8, "ready"), done: true }),
			);
			yield* processCurrent(source.id);
			const finished = yield* streams.get(source.id);
			expect(finished?.completedRevision).toBe(finished?.streamRevision);
			expect(yield* projection(source.eventId)).toEqual({ properties: { score: 8 } });
		}),
	);

	test.effect("does not lose an input wakeup that races a waiting result", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const source = yield* seedStream("waiting-race");
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			yield* controls.setProcessor(source.id, () =>
				Effect.gen(function* () {
					yield* seedAdjustment({ id: "waiting-race-input", entityId: source.entityId }).pipe(
						Effect.provideService(DatabaseSession, session),
						Effect.provideService(EventsRepository, events),
						Effect.provideService(StreamWorkFixture, source.fixture),
						Effect.orDie,
					);
					return waitingOutput;
				}),
			);
			const old = yield* processCurrent(source.id);
			const next = yield* streams.get(source.id);
			assert(next?.currentJobId);
			expect(next.currentJobId).not.toBe(old.id);
			expect(next.status).toBe("queued");
			expect(next.checkpoint).toBeNull();
		}),
	);

	test.effect(
		"invalidates old and new property and session scopes during opposite reference moves",
		() =>
			Effect.gen(function* () {
				const controls = yield* StreamWorkControls;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const background = yield* BackgroundWorkService;
				const events = yield* EventsService;
				const left = yield* seedStream("move-left");
				const right = yield* seedStream("move-right");
				const holder = yield* seedStream("move-holder");
				const initialLeft = yield* currentJob(left.id);
				const initialRight = yield* currentJob(right.id);
				const first = yield* seedAdjustment({
					id: "move-first",
					subject: left.entityId,
					entityId: holder.entityId,
					sessionEntityId: left.entityId,
				});
				const second = yield* seedAdjustment({
					id: "move-second",
					subject: right.entityId,
					entityId: holder.entityId,
					sessionEntityId: right.entityId,
				});
				for (const [source, initial] of [
					[left, initialLeft],
					[right, initialRight],
				] as const) {
					yield* controls.setProcessor(source.id, () =>
						Effect.succeed({ ...page(source.eventId, 1, "old"), done: true }),
					);
					yield* process(initial);
					const current = yield* streams.get(source.id);
					assert(current?.currentJobId);
					yield* background.dispatch(current.currentJobId);
				}
				const beforeLeft = yield* streams.get(left.id);
				const beforeRight = yield* streams.get(right.id);
				assert(beforeLeft?.currentJobId);
				assert(beforeRight?.currentJobId);
				const leftJob = yield* background.start(beforeLeft.currentJobId);
				const rightJob = yield* background.start(beforeRight.currentJobId);
				assert(leftJob);
				assert(rightJob);
				yield* Effect.all(
					[
						events.edit(
							{
								eventId: first.id,
								patch: {
									sessionEntityId: right.entityId,
									properties: { remove: [], set: { subject: right.entityId } },
								},
							},
							userId,
							command("move-first"),
						),
						events.edit(
							{
								eventId: second.id,
								patch: {
									sessionEntityId: left.entityId,
									properties: { remove: [], set: { subject: left.entityId } },
								},
							},
							userId,
							command("move-second"),
						),
					],
					{ concurrency: 2 },
				);
				yield* process(leftJob);
				yield* process(rightJob);
				expect(yield* projection(left.eventId)).toBeNull();
				expect(yield* projection(right.eventId)).toBeNull();
				expect((yield* streams.get(left.id))?.streamRevision).toBe(beforeLeft.streamRevision + 2);
				expect((yield* streams.get(right.id))?.streamRevision).toBe(beforeRight.streamRevision + 2);
				yield* service.reconcile();
			}),
	);

	test.effect("serializes mapping phantoms with source writes in both commit orders", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const controls = yield* StreamWorkControls;
			for (const first of ["mapping", "source"]) {
				const parent = yield* seedStream(`phantom-${first}-parent`);
				const child = yield* seedStream(`phantom-${first}-child`);
				const holder = yield* seedStream(`phantom-${first}-holder`);
				const oldJob = yield* currentJob(child.id);
				const before = yield* streams.get(child.id);
				assert(before);
				const mapping = dependencyInput(child.fixture, {
					child: child.entityId,
					parent: parent.entityId,
					entityId: holder.entityId,
					id: `phantom-${first}-mapping`,
				});
				const source = {
					...mapping,
					properties: { value: 2 },
					entityId: parent.entityId,
					eventSchemaName: "Adjustment",
					eventSchemaSlug: adjustmentSchemaSlug,
					id: EventId.make(`phantom-${first}-input`),
				};
				const held = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const attempted = yield* Deferred.make<void>();
				const leader = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* events.createEvent(first === "mapping" ? mapping : source);
							yield* Deferred.succeed(held, undefined);
							yield* Deferred.await(release);
						}),
					)
					.pipe(Effect.forkChild);
				yield* Deferred.await(held);
				assertExitFails(
					yield* Effect.exit(
						session
							.transaction(
								session.run((db) =>
									db.execute(sql`
					select id from entity where id = ${parent.entityId} for no key update nowait
				`),
								),
							)
							.pipe(Effect.mapError(() => new DbError({ message: "Source reference is locked" }))),
					),
					new DbError({ message: "Source reference is locked" }),
				);
				const follower = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* Deferred.succeed(attempted, undefined);
							yield* events.createEvent(first === "mapping" ? source : mapping);
						}),
					)
					.pipe(Effect.forkChild);
				yield* Deferred.await(attempted);
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(leader);
				yield* Fiber.join(follower);
				const changed = yield* streams.get(child.id);
				expect(changed?.streamRevision).toBe(before.streamRevision + (first === "mapping" ? 2 : 1));
				yield* controls.setProcessor(child.id, () =>
					Effect.succeed({ ...page(child.eventId, 99, "stale-parent"), done: true }),
				);
				yield* process(oldJob);
				expect(yield* projection(child.eventId)).toBeNull();
				expect((yield* streams.get(child.id))?.completedRevision).toBeNull();
			}
		}),
	);

	test.effect("fences both targets of concurrent mapping moves and deletion", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const firstParent = yield* seedStream("mapping-move-parent-a");
			const secondParent = yield* seedStream("mapping-move-parent-b");
			const firstChild = yield* seedStream("mapping-move-child-a");
			const secondChild = yield* seedStream("mapping-move-child-b");
			const firstMapping = dependencyInput(firstChild.fixture, {
				id: "mapping-move-a",
				child: firstChild.entityId,
				parent: firstParent.entityId,
				entityId: firstParent.entityId,
			});
			const secondMapping = dependencyInput(firstChild.fixture, {
				id: "mapping-move-b",
				child: secondChild.entityId,
				parent: secondParent.entityId,
				entityId: secondParent.entityId,
			});
			yield* session.transaction(events.createEvent(firstMapping));
			yield* session.transaction(events.createEvent(secondMapping));
			const beforeFirst = yield* streams.get(firstChild.id);
			const beforeSecond = yield* streams.get(secondChild.id);
			assert(beforeFirst);
			assert(beforeSecond);
			const a = yield* events.getEventSnapshot({ userId, eventId: firstMapping.id });
			const b = yield* events.getEventSnapshot({ userId, eventId: secondMapping.id });
			assert(a);
			assert(b);
			yield* Effect.all(
				[
					session.transaction(
						events.updatePreparedEvent({
							userId,
							updatedAt: occurredAt,
							eventId: firstMapping.id,
							expectedRevision: a.revision,
							draft: {
								...a.snapshot,
								properties: { child: secondChild.entityId, parent: secondParent.entityId },
							},
						}),
					),
					session.transaction(
						events.updatePreparedEvent({
							userId,
							updatedAt: occurredAt,
							eventId: secondMapping.id,
							expectedRevision: b.revision,
							draft: {
								...b.snapshot,
								properties: { child: firstChild.entityId, parent: firstParent.entityId },
							},
						}),
					),
				],
				{ concurrency: 2 },
			);
			expect((yield* streams.get(firstChild.id))?.streamRevision).toBe(
				beforeFirst.streamRevision + 2,
			);
			expect((yield* streams.get(secondChild.id))?.streamRevision).toBe(
				beforeSecond.streamRevision + 2,
			);
			yield* session.transaction(events.deleteEvent({ userId, eventId: secondMapping.id }));
			expect((yield* streams.get(firstChild.id))?.streamRevision).toBe(
				beforeFirst.streamRevision + 3,
			);
			yield* seedAdjustment({ entityId: firstParent.entityId, id: "mapping-move-parent-write" });
			expect((yield* streams.get(firstChild.id))?.streamRevision).toBe(
				beforeFirst.streamRevision + 3,
			);
			yield* seedAdjustment({
				entityId: secondParent.entityId,
				id: "mapping-move-other-parent-write",
			});
			expect((yield* streams.get(secondChild.id))?.streamRevision).toBe(
				beforeSecond.streamRevision + 3,
			);
		}),
	);

	test.effect("maps session and property inputs without crossing user or plugin ownership", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const parent = yield* seedStream("mapping-owner-parent");
			const child = yield* seedStream("mapping-owner-child");
			const excluded = yield* seedStream("mapping-owner-excluded");
			const holder = yield* seedStream("mapping-owner-holder");
			yield* session.transaction(
				events.createEvent(
					dependencyInput(child.fixture, {
						child: child.entityId,
						parent: parent.entityId,
						id: "mapping-owner-valid",
						entityId: holder.entityId,
					}),
				),
			);
			yield* session.run((db) =>
				db.insert(tables.event).values([
					{
						...dependencyInput(child.fixture, {
							parent: parent.entityId,
							child: excluded.entityId,
							entityId: holder.entityId,
							id: "mapping-owner-foreign-user",
						}),
						userId: "recipient",
					},
					{
						...dependencyInput(child.fixture, {
							parent: parent.entityId,
							child: excluded.entityId,
							entityId: holder.entityId,
							id: "mapping-owner-foreign-plugin",
						}),
						eventSchemaPluginId: null,
					},
				]),
			);
			const before = yield* streams.get(child.id);
			const excludedBefore = yield* streams.get(excluded.id);
			assert(before);
			assert(excludedBefore);
			yield* seedAdjustment({
				entityId: holder.entityId,
				sessionEntityId: parent.entityId,
				id: "mapping-owner-session-input",
			});
			yield* seedAdjustment({
				subject: parent.entityId,
				entityId: holder.entityId,
				id: "mapping-owner-property-input",
			});
			expect((yield* streams.get(child.id))?.streamRevision).toBe(before.streamRevision + 2);
			expect((yield* streams.get(excluded.id))?.streamRevision).toBe(excludedBefore.streamRevision);
		}),
	);

	test.effect(
		"admits seeded streams before discovery and every discovered page before the next page",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const source = yield* seedRetainedDependencyTargets("discovery-pages", 201);
				const firstChild = source.children[0];
				assert(firstChild);
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values(
							dependencyInput(source.fixture, {
								child: firstChild,
								parent: source.holder,
								entityId: source.holder,
								id: "discovery-pages-duplicate-edge",
							}),
						),
				);
				yield* session.run((db) =>
					db.insert(tables.eventStream).values({ ...source.key, revision: 7, id: source.id }),
				);
				const facts = yield* sourceState(source.eventId);
				const firstEntered = yield* Deferred.make<void>();
				const firstRelease = yield* Deferred.make<void>();
				const secondEntered = yield* Deferred.make<void>();
				const secondRelease = yield* Deferred.make<void>();
				let discoveries = 0;
				yield* controls.setBeforeDiscovery(
					Effect.gen(function* () {
						discoveries += 1;
						if (discoveries === 1) {
							yield* Deferred.succeed(firstEntered, undefined);
							yield* Deferred.await(firstRelease);
						} else if (discoveries === 2) {
							yield* Deferred.succeed(secondEntered, undefined);
							yield* Deferred.await(secondRelease);
						}
					}),
				);
				const beforeCalls = (yield* controls.workflowCalls).length;
				const reconciliation = yield* service.reconcile().pipe(Effect.forkChild);
				const ids = source.children.map((entityId) => eventStreamId({ ...source.key, entityId }));
				const states = session.run((db) =>
					db
						.select({
							id: tables.eventStream.id,
							step: tables.eventStreamWork.step,
							revision: tables.eventStream.revision,
							currentJobId: tables.eventStreamWork.currentJobId,
							accountToken: tables.eventStreamWork.accountToken,
						})
						.from(tables.eventStream)
						.innerJoin(tables.eventStreamWork, eq(tables.eventStreamWork.id, tables.eventStream.id))
						.where(inArray(tables.eventStream.id, ids))
						.orderBy(tables.eventStream.id),
				);
				yield* Effect.gen(function* () {
					yield* Deferred.await(firstEntered);
					const seeded = yield* streams.get(source.id);
					assert(seeded?.currentJobId);
					expect(seeded.streamRevision).toBe(7);
					expect(seeded.accountToken).toBe(accountToken);
					expect((yield* controls.workflowCalls).slice(beforeCalls)).toContainEqual(
						objectContaining({ inTransaction: false, executionId: seeded.currentJobId }),
					);
					yield* Deferred.succeed(firstRelease, undefined);
					yield* Deferred.await(secondEntered);
					const firstPage = yield* states;
					expect(firstPage).toHaveLength(100);
					expect(firstPage.every((work) => work.currentJobId !== null)).toBe(true);
					yield* Deferred.succeed(secondRelease, undefined);
					yield* Fiber.join(reconciliation);
					const completedDiscovery = yield* states;
					expect(completedDiscovery).toHaveLength(201);
					expect(completedDiscovery.every((work) => work.currentJobId !== null)).toBe(true);
					expect(completedDiscovery.every((work) => work.accountToken === accountToken)).toBe(true);
					expect(completedDiscovery.every((work) => work.revision === 0 && work.step === 1)).toBe(
						true,
					);
					expect(yield* sourceState(source.eventId)).toEqual(facts);
					yield* service.reconcile();
					expect(yield* states).toEqual(completedDiscovery);
					expect((yield* streams.get(source.id))?.streamRevision).toBe(7);
				}).pipe(
					Effect.ensuring(
						Effect.gen(function* () {
							yield* Deferred.succeed(firstRelease, undefined);
							yield* Deferred.succeed(secondRelease, undefined);
							yield* controls.setBeforeDiscovery(Effect.void);
							yield* Fiber.interrupt(reconciliation);
						}),
					),
				);
			}),
	);

	test.effect(
		"preserves source ordinals, reference scopes, restart flags, and exact target ownership",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const source = yield* seedRetainedDependencyTargets("dependency-targets", 2);
				const [first, second] = source.children;
				assert(first);
				assert(second);
				const shared = EntityId.make("dependency-shared-target");
				const foreignUser = EntityId.make("dependency-foreign-user-target");
				const foreignPlugin = EntityId.make("dependency-foreign-plugin-target");
				const wrongSchema = EntityId.make("dependency-wrong-schema-target");
				const wrongPlugin = EntityId.make("dependency-wrong-plugin-target");
				const wrongOwner = EntityId.make("dependency-wrong-owner-target");
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values([
							...[shared, foreignUser, foreignPlugin].map((id) => ({
								id,
								name: id,
								entitySchemaSlug,
								entitySchemaPluginId: source.fixture.pluginId,
							})),
							{
								id: wrongSchema,
								name: wrongSchema,
								entitySchemaSlug: "other",
								entitySchemaPluginId: source.fixture.pluginId,
							},
							{ id: wrongPlugin, entitySchemaSlug, name: wrongPlugin },
							{
								id: wrongOwner,
								name: wrongOwner,
								entitySchemaSlug,
								userId: "recipient",
								entitySchemaPluginId: source.fixture.pluginId,
							},
						]),
				);
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values([
							...[shared, wrongSchema, wrongPlugin, wrongOwner].map((child) =>
								dependencyInput(source.fixture, {
									child,
									parent: source.holder,
									entityId: source.holder,
									id: `dependency-targets-${child}`,
								}),
							),
							{
								...dependencyInput(source.fixture, {
									child: foreignUser,
									parent: source.holder,
									entityId: source.holder,
									id: "dependency-targets-foreign-user",
								}),
								userId: "recipient",
							},
							{
								...dependencyInput(source.fixture, {
									child: foreignPlugin,
									parent: source.holder,
									entityId: source.holder,
									id: "dependency-targets-foreign-plugin",
								}),
								eventSchemaPluginId: null,
							},
						]),
				);
				const adjustment = {
					...source.key,
					sessionEntityId: first,
					properties: { subject: second },
					eventSchemaSlug: adjustmentSchemaSlug,
				};
				const rows = yield* session.run((db) =>
					db.execute<StreamKey & { sourceIndex: number; restart: null | boolean }>(
						sql`
					select * from (${projectionDependencyTargets(
						projectionSources([
							{ ...source.key, sessionEntityId: source.holder },
							adjustment,
							adjustment,
							{
								...source.key,
								properties: { child: second },
								eventSchemaSlug: dependencySchemaSlug,
							},
							{
								...adjustment,
								entityId: wrongSchema,
								sessionEntityId: null,
								properties: { subject: null },
							},
							{ ...adjustment, properties: {}, entityId: wrongSchema, sessionEntityId: null },
							{ ...adjustment, eventSchemaPluginId: null },
							{
								...adjustment,
								properties: {},
								sessionEntityId: null,
								userId: UserId.make("recipient"),
							},
							{
								...adjustment,
								entityId: wrongSchema,
								sessionEntityId: shared,
								properties: { subject: shared },
							},
							{
								...source.key,
								properties: { child: wrongOwner },
								eventSchemaSlug: dependencySchemaSlug,
							},
							{
								...source.key,
								eventSchemaSlug: dependencySchemaSlug,
								properties: { parent: null, child: shared },
							},
						]),
					)}) targets order by "sourceIndex", "entityId", restart
				`,
						"objects",
					),
				);
				expect(rows).toEqual(
					[
						{ userId, sourceIndex: 0, restart: false, entityId: source.holder },
						{ userId, restart: true, sourceIndex: 0, entityId: source.holder },
						...[1, 2].flatMap((sourceIndex) =>
							[first, second, source.holder, shared].map((entityId) => ({
								userId,
								entityId,
								sourceIndex,
								restart: true,
							})),
						),
						{ userId, restart: true, sourceIndex: 3, entityId: second },
						{
							restart: true,
							sourceIndex: 7,
							entityId: foreignUser,
							userId: UserId.make("recipient"),
						},
						{ userId, restart: true, sourceIndex: 8, entityId: shared },
						{ userId, restart: true, sourceIndex: 10, entityId: shared },
					].map((target) =>
						Object.assign(target, {
							eventSchemaSlug,
							eventSchemaPluginId: source.fixture.pluginId,
						}),
					),
				);
				const service = yield* EventStreamWorkService;
				const streams = yield* EventStreamRepository;
				const controls = yield* StreamWorkControls;
				yield* service.request({
					pluginPin: source.fixture.pluginPin,
					accountGeneration: source.fixture.accountGeneration,
					processorScriptId: source.fixture.processorScriptId,
					request: { eventSchemaSlug, entityId: source.holder },
					command: { ...command("same-stream-restart"), writeContext: source.fixture.principal },
				});
				yield* controls.setProcessor(source.id, () =>
					Effect.succeed({ ...page(source.eventId, 1, "complete"), done: true }),
				);
				yield* processCurrent(source.id);
				const before = yield* streams.get(source.id);
				assert(before);
				yield* session.transaction(
					streams.touch([{ ...source.key, occurredAt, sessionEntityId: source.holder }]),
				);
				const after = yield* streams.get(source.id);
				expect(after?.streamRevision).toBe(before.streamRevision + 1);
				expect(after?.checkpoint).toBeNull();
				expect(after?.dirtyFrom).toBeNull();
				expect(after?.currentJobId).toBeNull();
			}),
	);

	test.effect("does not treat JSON null through mappings as absent mappings", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const source = yield* seedRetainedDependencyTargets("dependency-json-null", 1);
			const rows = yield* session.run((db) =>
				db.execute<StreamKey & { sourceIndex: number; restart: null | boolean }>(
					sql`
					with definition_event_schema as (
						select d.id, d.entity_schema_id, d.slug, ${JSON.stringify({
							inputs: [
								{ eventSchemaSlug, scope: "entity" },
								{ through: null, eventSchemaSlug, scope: "entity" },
							],
						})}::jsonb as projection
						from definition_event_schema d
						join definition_entity_schema e on e.id = d.entity_schema_id
						where e.plugin_revision_id = ${source.fixture.pluginPin.revisionId} and d.slug = ${eventSchemaSlug}
					)
					select * from (${projectionDependencyTargets(projectionSources([source.key]))}) targets
				`,
					"objects",
				),
			);
			expect(rows).toEqual([{ ...source.key, sourceIndex: 0, restart: false }]);
		}),
	);

	test.effect(
		"restores and discovers input-only reverse targets before their output events exist",
		() =>
			Effect.gen(function* () {
				const restore = yield* BackupRestorePersistence.make;
				const fixture = yield* StreamWorkFixture;
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const controls = yield* StreamWorkControls;
				const parent = EntityId.make("restore-mapped-parent");
				const child = EntityId.make("restore-mapped-child");
				const holder = EntityId.make("restore-mapped-holder");
				yield* session.transaction(
					Effect.gen(function* () {
						for (const id of [parent, child, holder]) {
							yield* restore.restoreEntity({
								id,
								userId,
								name: id,
								properties: {},
								entitySchemaSlug,
								entitySchemaPluginId: fixture.pluginId,
							});
						}
						yield* restore.restoreEvents([
							dependencyInput(fixture, {
								child,
								parent,
								entityId: holder,
								id: "restore-mapped-edge",
							}),
							{
								userId,
								occurredAt,
								entityId: holder,
								sessionEntityId: parent,
								id: "restore-mapped-input",
								eventSchemaSlug: adjustmentSchemaSlug,
								eventSchemaPluginId: fixture.pluginId,
								properties: { value: 2, subject: parent },
							},
						]);
					}),
				);
				const id = eventStreamId({
					userId,
					entityId: child,
					eventSchemaSlug,
					eventSchemaPluginId: fixture.pluginId,
				});
				const [seeded] = yield* session.run((db) =>
					db.select().from(tables.eventStream).where(eq(tables.eventStream.id, id)),
				);
				assert(seeded);
				expect(seeded.revision).toBeGreaterThan(0);
				yield* session.run((db) =>
					db.delete(tables.eventStream).where(eq(tables.eventStream.id, id)),
				);
				yield* service.reconcile();
				const discovered = yield* streams.get(id);
				assert(discovered);
				expect(discovered.pluginRevisionId).toBe(fixture.pluginPin.revisionId);
				expect(discovered.processorScriptId).toBe(fixture.processorScriptId);
				expect(discovered.accountToken).toBe(accountToken);
				yield* controls.setProcessor(id, () =>
					Effect.succeed({ done: true, updates: [], checkpoint: null }),
				);
				yield* processCurrent(id);
				const ready = yield* streams.get(id);
				expect(ready?.completedRevision).toBe(ready?.streamRevision);
			}),
	);

	test.effect("invalidates every mapped stream beyond one processor page", () =>
		Effect.gen(function* () {
			const restore = yield* BackupRestorePersistence.make;
			const session = yield* DatabaseSession;
			const parent = yield* seedStream("fanout-parent");
			const children = Array.from({ length: 101 }, (_, index) =>
				EntityId.make(`fanout-child-${index}`),
			);
			yield* session.transaction(
				Effect.gen(function* () {
					for (const child of children) {
						yield* restore.restoreEntity({
							userId,
							id: child,
							name: child,
							properties: {},
							entitySchemaSlug,
							entitySchemaPluginId: parent.fixture.pluginId,
						});
					}
					yield* restore.restoreEvents(
						children.map((child) =>
							dependencyInput(parent.fixture, {
								child,
								parent: parent.entityId,
								entityId: parent.entityId,
								id: `fanout-edge-${child}`,
							}),
						),
					);
				}),
			);
			const ids = children.map((entityId) =>
				eventStreamId({
					userId,
					entityId,
					eventSchemaSlug,
					eventSchemaPluginId: parent.fixture.pluginId,
				}),
			);
			const before = yield* session.run((db) =>
				db.select().from(tables.eventStream).where(inArray(tables.eventStream.id, ids)),
			);
			expect(before).toHaveLength(101);
			yield* seedAdjustment({ id: "fanout-source", entityId: parent.entityId });
			const after = yield* session.run((db) =>
				db.select().from(tables.eventStream).where(inArray(tables.eventStream.id, ids)),
			);
			expect(after).toHaveLength(101);
			for (const stream of before) {
				expect(after.find(({ id }) => id === stream.id)?.revision).toBe(stream.revision + 1);
			}
		}),
	);

	test.effect("rebuilds source-only restored streams through declaration reconciliation", () =>
		Effect.gen(function* () {
			const restore = yield* BackupRestorePersistence.make;
			const fixture = yield* StreamWorkFixture;
			const session = yield* DatabaseSession;
			const service = yield* EventStreamWorkService;
			const controls = yield* StreamWorkControls;
			const streams = yield* EventStreamRepository;
			const entityId = EntityId.make("restored-projection-entity");
			const eventId = EventId.make("restored-projection-source");
			yield* session.transaction(
				Effect.gen(function* () {
					yield* restore.restoreEntity({
						userId,
						id: entityId,
						properties: {},
						entitySchemaSlug,
						name: "Restored entity",
						entitySchemaPluginId: fixture.pluginId,
					});
					yield* restore.restoreEvents([
						{
							userId,
							entityId,
							occurredAt,
							id: eventId,
							eventSchemaSlug,
							properties: { rating: 4 },
							orderKey: "retained-order",
							orderCreatedAt: occurredAt,
							eventSchemaPluginId: fixture.pluginId,
						},
						{
							userId,
							entityId,
							occurredAt,
							properties: { value: 2 },
							id: "restored-projection-adjustment",
							eventSchemaSlug: adjustmentSchemaSlug,
							eventSchemaPluginId: fixture.pluginId,
						},
					]);
				}),
			);
			const id = eventStreamId({
				userId,
				entityId,
				eventSchemaSlug,
				eventSchemaPluginId: fixture.pluginId,
			});
			expect(yield* streams.get(id)).toBeNull();
			const source = yield* sourceState(eventId);
			yield* service.reconcile();
			const rebuilt = yield* streams.get(id);
			expect(rebuilt?.checkpoint).toBeNull();
			expect(rebuilt?.accountToken).toBe(accountToken);
			yield* controls.setProcessor(id, () =>
				Effect.succeed({ ...page(eventId, 6, "rebuilt"), done: true }),
			);
			yield* processCurrent(id);
			yield* service.reconcile();
			expect(yield* projection(eventId)).toEqual({ properties: { score: 6 } });
			expect(yield* sourceState(eventId)).toEqual(source);
			const complete = yield* streams.get(id);
			expect(complete?.completedRevision).toBe(complete?.streamRevision);
		}),
	);

	test.effect("rejects publication when the account is disabled during processor execution", () =>
		Effect.gen(function* () {
			const controls = yield* StreamWorkControls;
			const session = yield* DatabaseSession;
			const source = yield* seedStream("disabled-publish");
			yield* controls.setProcessor(source.id, () =>
				session
					.run((db) =>
						db
							.update(tables.user)
							.set({ disabledAt: occurredAt })
							.where(eq(tables.user.id, userId)),
					)
					.pipe(Effect.as({ ...page(source.eventId, 99, "disabled"), done: true })),
			);
			yield* Effect.gen(function* () {
				assertExitFails(
					yield* Effect.exit(processCurrent(source.id)),
					new DbError({ message: "Current domain write account authority is unavailable" }),
				);
				expect(yield* projection(source.eventId)).toBeNull();
			}).pipe(
				Effect.ensuring(
					session
						.run((db) =>
							db.update(tables.user).set({ disabledAt: null }).where(eq(tables.user.id, userId)),
						)
						.pipe(Effect.orDie),
				),
			);
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

	test.effect(
		"keeps unavailable bindings pending and discovers declarations added after retained history",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const service = yield* EventStreamWorkService;
				const initial = fixturePackage();
				const independent = {
					...initial,
					manifest: {
						...initial.manifest,
						metadata: { ...initial.manifest.metadata, packageId: testPluginPackageId() },
					},
				};
				const installed = yield* installRevisionPackage(independent);
				const pluginId = PluginId.make(installed.pluginId);
				const entityId = EntityId.make("late-declaration-target");
				const eventId = EventId.make("late-declaration-retained-input");
				const key = { userId, entityId, eventSchemaSlug, eventSchemaPluginId: pluginId };
				const id = eventStreamId(key);
				yield* session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId,
							id: entityId,
							name: entityId,
							entitySchemaSlug,
							entitySchemaPluginId: pluginId,
						}),
				);
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values({
							userId,
							entityId,
							occurredAt,
							id: eventId,
							properties: { value: 3 },
							sessionEntityId: entityId,
							eventSchemaPluginId: pluginId,
							eventSchemaSlug: adjustmentSchemaSlug,
						}),
				);
				yield* session.run((db) => db.insert(tables.eventStream).values({ ...key, id }));
				yield* session.run((db) =>
					db
						.update(tables.pluginInstallation)
						.set({ health: "installing" })
						.where(eq(tables.pluginInstallation.pluginId, pluginId)),
				);
				const healthy = yield* seedRetainedDependencyTargets("unavailable-binding-healthy", 1);
				yield* session.run((db) =>
					db.insert(tables.eventStream).values({ ...healthy.key, id: healthy.id }),
				);
				const facts = yield* sourceState(eventId);
				yield* service.reconcile();
				expect(yield* streams.get(id)).toBeNull();
				const healthyWork = yield* streams.get(healthy.id);
				assert(healthyWork?.currentJobId);
				const lateSlug = EventSchemaSlug.make("late-declared-output");
				const lateId = eventStreamId({ ...key, eventSchemaSlug: lateSlug });
				const lateDeclaration: PluginManifest["entitySchemas"][number]["eventSchemas"][number] = {
					...eventSchema,
					slug: lateSlug,
					projection: {
						...eventSchema.projection,
						inputs: [
							{ scope: "entity", eventSchemaSlug: lateSlug },
							{ scope: "session", eventSchemaSlug: adjustmentSchemaSlug },
						],
					},
				};
				const replacement = yield* installRevisionPackage({
					...independent,
					contentHash: "stream-fixture-late-declaration",
					manifest: {
						...independent.manifest,
						entitySchemas: independent.manifest.entitySchemas.map((schema) =>
							Object.assign({}, schema, {
								eventSchemas: [...schema.eventSchemas, lateDeclaration],
							}),
						),
					},
				});
				expect(replacement.pluginId).toBe(pluginId);
				expect(yield* streams.get(lateId)).toBeNull();
				yield* service.reconcile();
				const rebound = yield* streams.get(id);
				const discovered = yield* streams.get(lateId);
				assert(rebound?.currentJobId);
				assert(discovered?.currentJobId);
				expect(rebound.pluginRevisionId).toBe(replacement.revisionId);
				expect(discovered.pluginRevisionId).toBe(replacement.revisionId);
				expect(discovered.accountToken).toBe(accountToken);
				expect(discovered.checkpoint).toBeNull();
				expect(discovered.completedRevision).toBeNull();
				expect(yield* sourceState(eventId)).toEqual(facts);
				yield* service.reconcile();
				expect((yield* streams.get(lateId))?.currentJobId).toBe(discovered.currentJobId);
				expect((yield* streams.get(lateId))?.streamRevision).toBe(discovered.streamRevision);
			}),
	);
});
