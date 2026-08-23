import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
import { DbError, SandboxRunError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationHookSlug,
	AutomationExecutionId,
	AutomationTriggerId,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, FileSystem, Layer, Logger, References, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand, LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { CollectionsService } from "#modules/collections/service";
import {
	type DefinitionSource,
	makeDefinitionRegistry,
} from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import {
	EntityImportError,
	EntityImportWorkflow,
} from "#modules/provider-entities/entity-import-workflow";
import { EntityImportWorkflowOperations } from "#modules/provider-entities/operations-workflow";
import { RelationshipsService } from "#modules/relationships/service";

import { ImportRunFailuresService } from "./failure-service";
import {
	ProcessGenericImportChunksWorkflow,
	runProcessGenericImportChunksWorkflow,
} from "./generic-import-workflow";
import { ImportsService } from "./service";

const collectionsLayer = Layer.mock(CollectionsService)({});
const makePluginRuntime = (
	definitions = makeDefinitionRegistry().getSnapshot(),
	onResolve: () => void = () => {},
) =>
	Layer.mock(PluginRuntimeResolver)({
		getEffectiveDefinitions: () => Effect.sync(onResolve).pipe(Effect.as(definitions)),
	});
const artifactStoreLayer = Layer.mock(SandboxArtifactStore)({
	retain: () => Effect.void,
	release: () => Effect.void,
	resolveOutputs: (_ownerExecutionId, handles) => Effect.succeed([...handles]),
});
const providerOperationsLayer = Layer.mock(EntityImportWorkflowOperations)({
	processSandbox: () => Effect.die("unexpected provider details"),
	processProviderResolve: () => Effect.die("unexpected provider resolve"),
	completeProviderEntityImport: () => Effect.die("unexpected provider completion"),
});
const transactionDatabaseLayer = Layer.succeed(
	Database,
	Database.of(
		Object.assign(Object.create(null), {
			transaction: ((callback) =>
				callback(Object.create(null))) satisfies Database["Service"]["transaction"],
		}),
	),
);
const dispatchPlan = (triggerId: string) => ({
	runs: [],
	blockedReason: null,
	triggerId: AutomationTriggerId.make(triggerId),
});
const lifecycleDependencies = Layer.mergeAll(
	Layer.succeed(PgClient.PgClient, Object.create(null)),
	Layer.mock(LifecyclePlanner)({}),
	Layer.mock(LifecycleExecution)({ dispatch: (plans) => Effect.succeed(plans.map(() => warning)) }),
);
const warning = {
	code: "required-hook-failed",
	runId: AutomationRunId.make("import-warning-run"),
	hookSlug: AutomationHookSlug.make("fixture.after-import"),
} as const satisfies AutomationWarning;

const importCommand = (
	executionId: string,
	runId: ImportRunId,
	userId: UserId,
	integrationId?: IntegrationId,
): LifecycleCommand =>
	rootLifecycleCommand({
		importRunId: runId,
		source: integrationId ? "integration" : "import",
		initiator: integrationId
			? { id: integrationId, kind: "integration" }
			: { id: userId, kind: "user" },
		...(integrationId ? { integrationId } : {}),
		itemIdentity: JSON.stringify(["import-run", runId]),
		executionId: AutomationExecutionId.make(executionId),
		occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
	});

const makeRelationshipSchemaImportItem = (
	itemIndex: number,
	relationshipSchemaSlug: string,
	sourceEntitySchemaSlug: string,
	targetEntitySchemaSlug: string,
) => ({
	itemIndex,
	events: [],
	collectionMemberships: [],
	subjectEntityAlias: "source",
	sourceLabel: `Item ${itemIndex}`,
	sourceIdentifier: String(itemIndex),
	relationships: [
		{ properties: {}, sourceAlias: "source", targetAlias: "target", relationshipSchemaSlug },
	],
	entities: [
		{
			properties: {},
			alias: "source",
			name: `source-${itemIndex}`,
			entitySchemaSlug: sourceEntitySchemaSlug,
		},
		{
			properties: {},
			alias: "target",
			name: `target-${itemIndex}`,
			entitySchemaSlug: targetEntitySchemaSlug,
		},
	],
});

const providerImportIntent = (value: string, name: string) => ({
	name,
	alias: "routine",
	scope: "user" as const,
	entitySchemaSlug: "routine",
	properties: { kind: "exercise" },
	match: { name: "Routine", properties: { kind: "exercise" } },
	providerResolution: { value, providerSlug: "fitness", identifierType: "source-id" },
});

const makeProviderImportItem = (
	itemIndex: number,
	entity: ReturnType<typeof providerImportIntent> | object,
) => ({
	itemIndex,
	relationships: [],
	entities: [entity],
	subjectEntityAlias: "routine",
	sourceLabel: `Routine ${itemIndex}`,
	sourceIdentifier: String(itemIndex),
	events: [
		{
			properties: {},
			entityAlias: "routine",
			eventSchemaSlug: "completed",
			occurredAt: "2026-01-02T03:04:05.000Z",
		},
	],
});

it.effect("processes generic entity, relationship, event, and collection writes", () => {
	const executionId = "generic-import";
	const rootExecutionId = "import-root";
	const updates: Array<Record<string, unknown>> = [];
	const failures: Array<Record<string, unknown>> = [];
	const entities: Array<Record<string, unknown>> = [];
	const relationships: Array<Record<string, unknown>> = [];
	const entityCommands: LifecycleCommand[] = [];
	const eventCommands: LifecycleCommand[] = [];
	const relationshipCommands: LifecycleCommand[] = [];
	const eventInputs: Array<Record<string, unknown>> = [];
	const collectionExecutions: Array<Record<string, unknown>> = [];
	const warningLogs: Array<Readonly<Record<string, unknown>>> = [];
	const logger = Logger.make<unknown, void>((options) => {
		if (
			String(options.message).includes("generic import item completed with automation warnings")
		) {
			warningLogs.push(options.fiber.getRef(References.CurrentLogAnnotations));
		}
	});
	const directory = "/tmp/ryot-sandbox-harvest-test/generic-import-activity-0";
	const path = `${directory}/chunk-0.json`;
	const instance = WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, executionId);

	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(directory, { recursive: true });
		yield* fs.writeFileString(
			path,
			yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				failures: [
					{
						itemIndex: 0,
						sourceLabel: "Row 1",
						stage: "source_fetch",
						sourceIdentifier: "1",
						message: "Could not parse date/time value",
					},
				],
				items: [
					{
						itemIndex: 1,
						subjectEntityAlias: "direct",
						sourceIdentifier: "collection-1",
						sourceLabel: "Imported collection",
						collectionMemberships: [{ entityAlias: "direct", collectionName: "Favorites" }],
						events: [
							{
								entityAlias: "existing",
								eventSchemaSlug: "review",
								sessionEntityAlias: "session",
								occurredAt: "2026-01-02T03:04:05.000Z",
								subjectEntityId: "existing-collection",
								properties: { rating: 90, isSpoiler: false, text: "Imported body" },
							},
						],
						relationships: [
							{
								sourceAlias: "session",
								targetAlias: "existing",
								properties: { rank: 7 },
								relationshipSchemaSlug: "member-of",
							},
							{
								sourceAlias: "direct",
								properties: { rank: 0 },
								propertiesMode: "merge",
								targetAlias: "mediaLibrary",
								relationshipSchemaSlug: "member-of",
							},
						],
						entities: [
							{
								alias: "existing",
								entitySchemaSlug: "collection",
								properties: { kind: "tracked" },
								name: "Ignored replacement name",
								match: {
									name: "my existing",
									nameNormalization: "slug",
									properties: { kind: "tracked" },
								},
							},
							{
								alias: "session",
								name: "Created collection",
								entitySchemaSlug: "collection",
								properties: { kind: "session" },
							},
							{
								properties: {},
								alias: "direct",
								name: "Existing example",
								entityId: "direct-example",
								entitySchemaSlug: "collection",
							},
							{
								scope: "user",
								properties: {},
								name: "Library",
								existingOnly: true,
								alias: "mediaLibrary",
								entitySchemaSlug: "collection",
								match: { properties: {}, name: "Library" },
							},
						],
					},
					{
						events: [],
						itemIndex: 2,
						collectionMemberships: [],
						subjectEntityAlias: "example",
						sourceIdentifier: "example-1",
						sourceLabel: "Imported example",
						relationships: [
							{
								sourceAlias: "example",
								properties: { rank: 0 },
								propertiesMode: "merge",
								targetAlias: "mediaLibrary",
								relationshipSchemaSlug: "member-of",
							},
						],
						entities: [
							{
								properties: {},
								alias: "example",
								name: "Failed example",
								entitySchemaSlug: "collection",
							},
							{
								scope: "user",
								properties: {},
								name: "Library",
								existingOnly: true,
								alias: "mediaLibrary",
								entitySchemaSlug: "collection",
								match: { properties: {}, name: "Library" },
							},
						],
					},
				],
			}),
		);

		const result = yield* runProcessGenericImportChunksWorkflow(
			{
				executionId,
				totalItems: 3,
				failureCount: 1,
				writeItemCount: 2,
				chunkHandles: [path],
				userId: UserId.make("user-1"),
				runId: ImportRunId.make("run-1"),
				artifactOwnerExecutionId: executionId,
				artifactReferenceExecutionId: executionId,
				command: importCommand(rootExecutionId, ImportRunId.make("run-1"), UserId.make("user-1")),
			},
			executionId,
		);

		expect(result).toEqual({ failedItems: 2, importedItems: 1, processedItems: 3 });
		expect(failures).toEqual([
			expect.objectContaining({
				itemIndex: 0,
				stage: "source_fetch",
				reason: { code: "source-fetch-failed" },
			}),
			expect.objectContaining({
				itemIndex: 2,
				stage: "database_commit",
				reason: { code: "database-commit-failed" },
			}),
		]);
		expect(entities).toEqual([
			expect.objectContaining({
				userId: "user-1",
				name: "Created collection",
				entitySchemaSlug: "collection",
				properties: { kind: "session" },
			}),
			expect.objectContaining({
				userId: "user-1",
				name: "Failed example",
				entitySchemaSlug: "collection",
			}),
		]);
		expect(relationships).toEqual([
			expect.objectContaining({
				properties: { rank: 7 },
				relationshipSchemaSlug: "member-of",
				sourceEntityId: "created-collection",
				targetEntityId: "existing-collection",
			}),
			expect.objectContaining({
				sourceEntityId: "direct-example",
				relationshipSchemaSlug: "member-of",
				targetEntityId: "library-collection",
			}),
		]);
		expect(eventInputs).toEqual([
			{
				userId: "user-1",
				payload: [
					{
						eventSchemaSlug: "review",
						entityId: "existing-collection",
						sessionEntityId: "created-collection",
						occurredAt: "2026-01-02T03:04:05.000Z",
						properties: { rating: 90, isSpoiler: false, text: "Imported body" },
					},
				],
			},
		]);
		expect(collectionExecutions).toEqual([
			expect.objectContaining({
				executionId: "generic-import-item-1-collection-0",
				payload: expect.objectContaining({
					entityId: "direct-example",
					collectionId: "favorites-collection",
				}),
			}),
		]);
		const collectionPayload = collectionExecutions[0]?.["payload"];
		assert(isObjectRecord(collectionPayload));
		const commands = [
			...entityCommands,
			...relationshipCommands,
			...eventCommands,
			yield* Schema.decodeUnknownEffect(LifecycleCommand)(collectionPayload["command"]),
		];
		expect(commands).toHaveLength(7);
		expect(new Set(commands.map(({ itemIdentity }) => itemIdentity)).size).toBe(7);
		for (const command of commands) {
			expect(command.causation).toEqual({
				depth: 0,
				rootExecutionId,
				source: "import",
				parentRunId: null,
				importRunId: "run-1",
				parentTriggerId: null,
				executionId: rootExecutionId,
				initiator: { id: "user-1", kind: "user" },
			});
		}
		expect(warningLogs).toEqual([
			expect.objectContaining({
				itemIndex: 1,
				runId: "run-1",
				warnings: [warning, warning, warning, warning, warning],
			}),
			expect.objectContaining({ itemIndex: 2, runId: "run-1", warnings: [warning] }),
		]);
		expect(updates).toContainEqual(
			expect.objectContaining({
				progress: 100,
				failedItems: 2,
				importedItems: 1,
				processedItems: 3,
			}),
		);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (_workflow, options) =>
					Effect.sync(() => {
						collectionExecutions.push(options);
						return {
							warnings: [warning],
							memberOf: {
								properties: {},
								createdAt: "2026-01-01T00:00:00.000Z",
								sourceEntityId: EntityId.make("direct-example"),
								id: RelationshipId.make("collection-membership"),
								targetEntityId: EntityId.make("favorites-collection"),
								relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
							},
						};
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				providerOperationsLayer,
				Logger.layer([logger]),
				artifactStoreLayer,
				databaseLayer,
				transactionDatabaseLayer,
				lifecycleDependencies,
				BunServices.layer,
				makeAppConfigLayer(),
				makePluginRuntime(),
				Layer.mock(CollectionsService)({
					prepareGetOrCreateCollection: () =>
						Effect.succeed({
							dispatch: [],
							_tag: "Committed",
							result: { id: EntityId.make("favorites-collection") },
						}),
				}),
				Layer.mock(RelationshipsService)({
					prepareMergeUserProperties: (input, command) =>
						Effect.sync(() => relationshipCommands.push(command)).pipe(
							Effect.andThen(
								input.targetEntityId === "library-collection" &&
									input.sourceEntityId !== "direct-example"
									? Effect.fail(new DbError({ message: "membership write failed" }))
									: Effect.sync(() => {
											relationships.push(input);
											return {
												_tag: "Committed" as const,
												result: { relationship: null },
												dispatch: [dispatchPlan("relationship-merge")],
											};
										}),
							),
						),
					prepareCreate: (input, command) =>
						Effect.sync(() => {
							relationships.push(input);
							relationshipCommands.push(command);
							assert(isObjectRecord(input.properties));
							return {
								_tag: "Committed" as const,
								dispatch: [dispatchPlan("relationship-create")],
								result: {
									relationship: {
										wasInserted: true,
										properties: input.properties,
										sourceEntityId: input.sourceEntityId,
										targetEntityId: input.targetEntityId,
										createdAt: "2026-01-01T00:00:00.000Z",
										updatedAt: "2026-01-01T00:00:00.000Z",
										id: RelationshipId.make("relationship-1"),
										relationshipSchemaSlug: input.relationshipSchemaSlug,
									},
								},
							};
						}),
				}),
				Layer.mock(EntitiesRepository)({
					getEntityScopeForUser: ({ entityId }) =>
						Effect.succeed({
							entityId,
							isBuiltin: true,
							entityName: "Library",
							entitySchemaPluginId: null,
							entitySchemaSlug: EntitySchemaSlug.make("collection"),
							entityUserId: entityId === "global-library" ? null : UserId.make("user-1"),
						}),
					getByIdForUser: ({ entityId }) =>
						Effect.succeed({
							id: entityId,
							providerId: null,
							externalId: null,
							populatedAt: null,
							name: "My Existing",
							properties: { kind: "tracked" },
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
							entitySchemaSlug: EntitySchemaSlug.make(
								entityId === "failed-example" ? "group" : "collection",
							),
						}),
					listMatchCandidatesBySchema: () =>
						Effect.succeed([
							{
								providerId: null,
								externalId: null,
								populatedAt: null,
								name: "My Existing",
								properties: { kind: "tracked" },
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								id: EntityId.make("existing-collection"),
								entitySchemaSlug: EntitySchemaSlug.make("collection"),
							},
							{
								properties: {},
								name: "Library",
								providerId: null,
								externalId: null,
								populatedAt: null,
								id: EntityId.make("global-library"),
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								entitySchemaSlug: EntitySchemaSlug.make("collection"),
							},
							{
								properties: {},
								name: "Library",
								providerId: null,
								externalId: null,
								populatedAt: null,
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								id: EntityId.make("library-collection"),
								entitySchemaSlug: EntitySchemaSlug.make("collection"),
							},
						]),
				}),
				Layer.mock(EntitiesService)({
					prepareCreateStep: (input) =>
						Effect.sync(() => {
							entities.push(input);
							entityCommands.push(input.lifecycle);
							assert(isObjectRecord(input.properties));
							const entity = {
								name: input.name,
								externalId: null,
								providerId: null,
								populatedAt: null,
								properties: input.properties,
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								id: EntityId.make("created-collection"),
								entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
							};
							return {
								_tag: "Committed" as const,
								dispatch: [dispatchPlan("entity-create")],
								result: {
									entity,
									wasInserted: true,
									outcome: {
										before: null,
										operation: "create" as const,
										after: { ...entity, properties: {} },
									},
								},
							};
						}),
				}),
				Layer.mock(EventsService)({
					create: (input, command) =>
						Effect.sync(() => {
							eventInputs.push(input);
							eventCommands.push(command);
							return { count: 1, outcomes: [], failure: null, warnings: [warning] };
						}),
				}),
				Layer.mock(ImportsService)({
					update: (input) => Effect.sync(() => updates.push(input)).pipe(Effect.asVoid),
				}),
				Layer.mock(ImportRunFailuresService)({
					create: (input) => Effect.sync(() => failures.push(input)).pipe(Effect.asVoid),
				}),
			),
		),
	);
});

it.effect("imports private event and relationship schemas from one effective snapshot", () => {
	const executionId = "generic-import-relationship-schemas";
	const pluginId = "private-plugin-id";
	const failures: Array<Record<string, unknown>> = [];
	const entityWrites: Array<string> = [];
	const commands: LifecycleCommand[] = [];
	const eventInputs: Array<Record<string, unknown>> = [];
	const relationshipWrites: Array<Record<string, unknown>> = [];
	const integrationId = IntegrationId.make("integration-relationship-schemas");
	let definitionResolutions = 0;
	const directory = `/tmp/ryot-sandbox-harvest-test/${executionId}-activity-0`;
	const path = `${directory}/chunk-0.json`;
	const instance = WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, executionId);
	const propertiesSchema = { fields: {}, unknownKeys: "strict" } as const;
	const definitionSource = {
		savedViews: [],
		signalSchemas: [],
		entitySchemas: ["source", "target", "other"].map((slug) => ({
			slug,
			pluginId,
			name: slug,
			icon: "circle",
			propertiesSchema,
			pluginSlug: "private-plugin",
			eventSchemas:
				slug === "other"
					? [{ propertiesSchema, name: "Private Event", slug: "private-event" }]
					: [],
		})),
		relationshipSchemas: [
			{
				pluginId,
				propertiesSchema,
				name: "Source constrained",
				slug: "source-constrained",
				targetEntitySchemaSlug: null,
				sourceEntitySchemaSlug: "source",
			},
			{
				pluginId,
				propertiesSchema,
				name: "Target constrained",
				slug: "target-constrained",
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: "target",
			},
			{
				pluginId,
				propertiesSchema,
				name: "Unrestricted",
				slug: "unrestricted",
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: null,
			},
		],
	} satisfies DefinitionSource;
	const definitions = makeDefinitionRegistry(definitionSource);

	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(directory, { recursive: true });
		yield* fs.writeFileString(
			path,
			yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				failures: [],
				items: [
					makeRelationshipSchemaImportItem(0, "source-constrained", "other", "target"),
					makeRelationshipSchemaImportItem(1, "target-constrained", "source", "other"),
					{
						...makeRelationshipSchemaImportItem(2, "unrestricted", "other", "other"),
						events: [
							{
								properties: {},
								entityAlias: "source",
								eventSchemaSlug: "private-event",
								occurredAt: "2026-01-02T03:04:05.000Z",
							},
						],
					},
				],
			}),
		);

		const result = yield* runProcessGenericImportChunksWorkflow(
			{
				executionId,
				totalItems: 3,
				failureCount: 0,
				writeItemCount: 3,
				chunkHandles: [path],
				userId: UserId.make("user-1"),
				artifactOwnerExecutionId: executionId,
				artifactReferenceExecutionId: executionId,
				runId: ImportRunId.make("run-relationship-schemas"),
				command: importCommand(
					executionId,
					ImportRunId.make("run-relationship-schemas"),
					UserId.make("user-1"),
					integrationId,
				),
			},
			executionId,
		);

		expect(result).toEqual({ failedItems: 2, importedItems: 1, processedItems: 3 });
		expect(failures).toEqual([
			expect.objectContaining({ itemIndex: 0, reason: { code: "database-commit-failed" } }),
			expect.objectContaining({ itemIndex: 1, reason: { code: "database-commit-failed" } }),
		]);
		expect(entityWrites).toEqual(["source-2", "target-2"]);
		expect(relationshipWrites).toEqual([
			expect.objectContaining({
				sourceEntityId: "source-2-id",
				targetEntityId: "target-2-id",
				relationshipSchemaPluginId: pluginId,
				relationshipSchemaSlug: "unrestricted",
			}),
		]);
		expect(eventInputs).toEqual([
			expect.objectContaining({
				payload: [expect.objectContaining({ properties: {}, eventSchemaSlug: "private-event" })],
			}),
		]);
		expect(commands).toHaveLength(4);
		for (const command of commands) {
			expect(command.causation).toMatchObject({
				executionId,
				integrationId,
				source: "integration",
				rootExecutionId: executionId,
				importRunId: "run-relationship-schemas",
				initiator: { id: integrationId, kind: "integration" },
			});
		}
		expect(definitionResolutions).toBe(1);
	}).pipe(
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				providerOperationsLayer,
				artifactStoreLayer,
				databaseLayer,
				transactionDatabaseLayer,
				lifecycleDependencies,
				BunServices.layer,
				makeAppConfigLayer(),
				collectionsLayer,
				makePluginRuntime(definitions.getSnapshot(), () => {
					definitionResolutions += 1;
				}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(EntitiesService)({
					prepareCreateStep: (input) =>
						Effect.sync(() => {
							entityWrites.push(input.name);
							commands.push(input.lifecycle);
							assert(isObjectRecord(input.properties));
							const entity = {
								name: input.name,
								providerId: null,
								externalId: null,
								populatedAt: null,
								properties: input.properties,
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								id: EntityId.make(`${input.name}-id`),
								entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
							};
							return {
								dispatch: [],
								_tag: "Committed" as const,
								result: {
									entity,
									wasInserted: true,
									outcome: {
										before: null,
										operation: "create" as const,
										after: { ...entity, properties: {} },
									},
								},
							};
						}),
				}),
				Layer.mock(RelationshipsService)({
					prepareCreate: (input, command) =>
						Effect.sync(() => {
							relationshipWrites.push(input);
							commands.push(command);
							return {
								dispatch: [],
								_tag: "Committed" as const,
								result: {
									relationship: {
										properties: {},
										wasInserted: true,
										sourceEntityId: input.sourceEntityId,
										targetEntityId: input.targetEntityId,
										createdAt: "2026-01-01T00:00:00.000Z",
										updatedAt: "2026-01-01T00:00:00.000Z",
										id: RelationshipId.make("relationship-1"),
										relationshipSchemaSlug: input.relationshipSchemaSlug,
									},
								},
							};
						}),
				}),
				Layer.mock(EventsService)({
					create: (input, command) =>
						Effect.sync(() => {
							eventInputs.push(input);
							commands.push(command);
							return { count: 1, outcomes: [], warnings: [], failure: null };
						}),
				}),
				Layer.mock(ImportsService)({ update: () => Effect.void }),
				Layer.mock(ImportRunFailuresService)({
					create: (input) => Effect.sync(() => failures.push(input)).pipe(Effect.asVoid),
				}),
			),
		),
	);
});

it.effect("resolves provider entities and preserves generic fallbacks and failure stages", () => {
	const executionId = "generic-provider-import";
	const userId = UserId.make("user-1");
	const providerId = SandboxProviderId.make("provider-1");
	const failures: Array<Record<string, unknown>> = [];
	const eventEntityIds: string[] = [];
	const createdNames: string[] = [];
	const providerExecutions: string[] = [];
	const directory = `/tmp/ryot-sandbox-harvest-test/${executionId}-activity-0`;
	const path = `${directory}/chunk-0.json`;
	const instance = WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, executionId);
	const definitions = makeDefinitionRegistry({
		savedViews: [],
		signalSchemas: [],
		relationshipSchemas: [],
		entitySchemas: [
			{
				icon: "circle",
				name: "Routine",
				slug: "routine",
				pluginSlug: "fitness",
				pluginId: "fitness-plugin",
				propertiesSchema: { fields: {}, unknownKeys: "passthrough" },
				eventSchemas: [
					{
						name: "Completed",
						slug: "completed",
						propertiesSchema: { fields: {}, unknownKeys: "strict" },
					},
				],
			},
		],
	} satisfies DefinitionSource).getSnapshot();
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(directory, { recursive: true });
		yield* fs.writeFileString(
			path,
			yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
				failures: [],
				items: [
					makeProviderImportItem(0, providerImportIntent("success-a", "Success A")),
					makeProviderImportItem(1, providerImportIntent("success-b", "Success B")),
					makeProviderImportItem(2, providerImportIntent("null", "Null fallback")),
					makeProviderImportItem(3, providerImportIntent("mismatch", "Mismatch fallback")),
					makeProviderImportItem(4, providerImportIntent("resolve-error", "Resolve failure")),
					makeProviderImportItem(5, providerImportIntent("details-error", "Details failure")),
					makeProviderImportItem(6, {
						properties: {},
						alias: "routine",
						name: "Old path",
						entitySchemaSlug: "routine",
					}),
				],
			}),
		);

		const result = yield* runProcessGenericImportChunksWorkflow(
			{
				userId,
				executionId,
				totalItems: 7,
				failureCount: 0,
				writeItemCount: 7,
				chunkHandles: [path],
				artifactOwnerExecutionId: executionId,
				runId: ImportRunId.make("provider-run"),
				artifactReferenceExecutionId: executionId,
				command: importCommand(executionId, ImportRunId.make("provider-run"), userId),
			},
			executionId,
		);

		expect(result).toEqual({ failedItems: 2, importedItems: 5, processedItems: 7 });
		expect(eventEntityIds).toEqual([
			"global-provider-entity",
			"global-provider-entity",
			"created-Null fallback",
			"created-Mismatch fallback",
			"created-Old path",
		]);
		expect(createdNames).toEqual(["Null fallback", "Mismatch fallback", "Old path"]);
		expect(providerExecutions).toEqual([
			`${executionId}-item-0-entity-0-provider-import`,
			`${executionId}-item-1-entity-0-provider-import`,
			`${executionId}-item-3-entity-0-provider-import`,
			`${executionId}-item-5-entity-0-provider-import`,
		]);
		expect(failures).toEqual([
			expect.objectContaining({
				itemIndex: 4,
				stage: "provider_resolution",
				reason: { code: "provider-resolution-failed" },
			}),
			expect.objectContaining({
				itemIndex: 5,
				stage: "provider_details",
				reason: { code: "provider-details-failed" },
			}),
		]);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) => {
					if (workflow._tag !== EntityImportWorkflow._tag) {
						return Effect.die(`Unexpected workflow: ${workflow._tag}`);
					}
					providerExecutions.push(options.executionId);
					if (options.executionId.includes("item-5-")) {
						return Effect.fail(
							new EntityImportError({ stage: "population", message: "details failed" }),
						);
					}
					return Effect.succeed({
						providerId,
						name: "Routine",
						externalId: "provider-external",
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						populatedAt: "2026-01-01T00:00:00.000Z",
						id: EntityId.make("global-provider-entity"),
						entitySchemaSlug: EntitySchemaSlug.make("routine"),
						properties: options.executionId.includes("item-3-")
							? { kind: "workout" }
							: { kind: "exercise" },
					});
				},
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				artifactStoreLayer,
				databaseLayer,
				transactionDatabaseLayer,
				lifecycleDependencies,
				BunServices.layer,
				makeAppConfigLayer(),
				collectionsLayer,
				Layer.mock(PluginRuntimeResolver)({
					getEffectiveDefinitions: () => Effect.succeed(definitions),
					findProviderAvailableToUserBySlug: () =>
						Effect.succeed({
							id: providerId,
							name: "Fitness",
							slug: "fitness",
							pluginId: "fitness-plugin",
							pluginScope: "system" as const,
							rootEntitySchemaSlug: "routine",
							information: { source: "provider" },
							createdAt: new Date("2026-01-01T00:00:00.000Z"),
							updatedAt: new Date("2026-01-01T00:00:00.000Z"),
						}),
				}),
				Layer.mock(EntityImportWorkflowOperations)({
					processSandbox: () => Effect.die("unexpected provider details"),
					completeProviderEntityImport: () => Effect.die("unexpected provider completion"),
					processProviderResolve: ({ value }) =>
						value === "resolve-error"
							? Effect.fail(
									new SandboxRunError({ kind: "infrastructure", message: "resolve failed" }),
								)
							: Effect.succeed({
									logs: [],
									error: null,
									status: "completed" as const,
									value: { externalId: value === "null" ? null : `external-${value}` },
								}),
				}),
				Layer.mock(EntitiesRepository)({ listMatchCandidatesBySchema: () => Effect.succeed([]) }),
				Layer.mock(EntitiesService)({
					prepareCreateStep: (input) =>
						Effect.sync(() => {
							createdNames.push(input.name);
							expect(input.scope).toBe("user");
							const entity = {
								name: input.name,
								providerId: null,
								externalId: null,
								populatedAt: null,
								properties: input.properties,
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								id: EntityId.make(`created-${input.name}`),
								entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
							};
							return {
								dispatch: [],
								_tag: "Committed" as const,
								result: {
									entity,
									wasInserted: true,
									outcome: {
										before: null,
										operation: "create" as const,
										after: { ...entity, properties: {} },
									},
								},
							};
						}),
				}),
				Layer.mock(RelationshipsService)({}),
				Layer.mock(EventsService)({
					create: ({ payload: events }) =>
						Effect.sync(() => {
							eventEntityIds.push(...events.map(({ entityId }) => entityId));
							return { outcomes: [], warnings: [], failure: null, count: events.length };
						}),
				}),
				Layer.mock(ImportsService)({ update: () => Effect.void }),
				Layer.mock(ImportRunFailuresService)({
					create: (input) => Effect.sync(() => failures.push(input)).pipe(Effect.asVoid),
				}),
			),
		),
	);
});

it.effect("fails before reading chunks when the initial run update fails", () => {
	const executionId = "generic-import-update-failure";
	const directory = `/tmp/ryot-sandbox-harvest-test/${executionId}-activity-0`;
	const path = `${directory}/chunk-0.json`;
	const instance = WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, executionId);

	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(directory, { recursive: true });
		yield* fs.writeFileString(path, "not read before the update fails");

		const exit = yield* Effect.exit(
			runProcessGenericImportChunksWorkflow(
				{
					executionId,
					totalItems: 0,
					failureCount: 0,
					writeItemCount: 0,
					chunkHandles: [path],
					userId: UserId.make("user-1"),
					artifactOwnerExecutionId: executionId,
					artifactReferenceExecutionId: executionId,
					runId: ImportRunId.make("run-update-failure"),
					command: importCommand(
						executionId,
						ImportRunId.make("run-update-failure"),
						UserId.make("user-1"),
					),
				},
				executionId,
			),
		);

		expect(exit._tag).toBe("Failure");
	}).pipe(
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				providerOperationsLayer,
				artifactStoreLayer,
				databaseLayer,
				transactionDatabaseLayer,
				lifecycleDependencies,
				BunServices.layer,
				makePluginRuntime(),
				collectionsLayer,
				Layer.mock(RelationshipsService)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(EventsService)({}),
				Layer.mock(ImportRunFailuresService)({}),
				Layer.mock(ImportsService)({
					update: () => Effect.fail(new DbError({ message: "initial update failed" })),
				}),
			),
		),
	);
});
