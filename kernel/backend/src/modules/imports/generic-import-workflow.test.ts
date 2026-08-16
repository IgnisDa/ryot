import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationWarning } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationHookSlug,
	AutomationExecutionId,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	IntegrationId,
	RelationshipId,
	RelationshipSchemaSlug,
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
const transactionDatabaseLayer = Layer.succeed(
	Database,
	Database.of(
		Object.assign(Object.create(null), {
			transaction: ((callback) =>
				callback(Object.create(null))) satisfies Database["Service"]["transaction"],
		}),
	),
);
const lifecycleDependencies = Layer.mergeAll(
	Layer.succeed(PgClient.PgClient, Object.create(null)),
	Layer.mock(LifecyclePlanner)({}),
	Layer.mock(LifecycleExecution)({}),
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
								targetAlias: "library",
								properties: { rank: 0 },
								propertiesMode: "merge",
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
								alias: "library",
								existingOnly: true,
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
								targetAlias: "library",
								properties: { rank: 0 },
								propertiesMode: "merge",
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
								alias: "library",
								existingOnly: true,
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
				Logger.layer([logger]),
				artifactStoreLayer,
				databaseLayer,
				transactionDatabaseLayer,
				lifecycleDependencies,
				BunServices.layer,
				makeAppConfigLayer(),
				makePluginRuntime(),
				Layer.mock(CollectionsService)({
					getOrCreateCollection: () =>
						Effect.succeed({
							warnings: [],
							properties: {},
							providerId: null,
							externalId: null,
							populatedAt: null,
							name: "Favorites",
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
							id: EntityId.make("favorites-collection"),
							entitySchemaSlug: EntitySchemaSlug.make("collection"),
						}),
				}),
				Layer.mock(RelationshipsService)({
					mergeUserProperties: (input, command) =>
						Effect.sync(() => relationshipCommands.push(command)).pipe(
							Effect.andThen(
								input.targetEntityId === "library-collection" &&
									input.sourceEntityId !== "direct-example"
									? Effect.fail(new DbError({ message: "membership write failed" }))
									: Effect.sync(() => {
											relationships.push(input);
											return { relationship: null, warnings: [warning] };
										}),
							),
						),
					create: (input, command) =>
						Effect.sync(() => {
							relationships.push(input);
							relationshipCommands.push(command);
							assert(isObjectRecord(input.properties));
							return {
								warnings: [warning],
								relationship: {
									wasInserted: true,
									properties: input.properties,
									sourceEntityId: input.sourceEntityId,
									targetEntityId: input.targetEntityId,
									createdAt: "2026-01-01T00:00:00.000Z",
									id: RelationshipId.make("relationship-1"),
									relationshipSchemaSlug: input.relationshipSchemaSlug,
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
					create: (input) =>
						Effect.sync(() => {
							entities.push(input);
							entityCommands.push(input.lifecycle);
							assert(isObjectRecord(input.properties));
							return {
								warnings: [warning],
								entity: {
									name: input.name,
									externalId: null,
									providerId: null,
									populatedAt: null,
									properties: input.properties,
									createdAt: "2026-01-01T00:00:00.000Z",
									updatedAt: "2026-01-01T00:00:00.000Z",
									id: EntityId.make("created-collection"),
									entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
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
					create: (input) =>
						Effect.sync(() => {
							entityWrites.push(input.name);
							commands.push(input.lifecycle);
							assert(isObjectRecord(input.properties));
							return {
								warnings: [],
								entity: {
									name: input.name,
									providerId: null,
									externalId: null,
									populatedAt: null,
									properties: input.properties,
									createdAt: "2026-01-01T00:00:00.000Z",
									updatedAt: "2026-01-01T00:00:00.000Z",
									id: EntityId.make(`${input.name}-id`),
									entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
								},
							};
						}),
				}),
				Layer.mock(RelationshipsService)({
					create: (input, command) =>
						Effect.sync(() => {
							relationshipWrites.push(input);
							commands.push(command);
							return {
								warnings: [],
								relationship: {
									properties: {},
									wasInserted: true,
									sourceEntityId: input.sourceEntityId,
									targetEntityId: input.targetEntityId,
									createdAt: "2026-01-01T00:00:00.000Z",
									id: RelationshipId.make("relationship-1"),
									relationshipSchemaSlug: input.relationshipSchemaSlug,
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
