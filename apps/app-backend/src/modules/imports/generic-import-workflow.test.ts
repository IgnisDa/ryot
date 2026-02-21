import { FileSystem } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaSlug,
	ImportRunId,
	RelationshipId,
	UserId,
} from "@ryot/contract/schema/brands";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Layer, Schema } from "effect";
import { assert } from "vitest";

import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipsService } from "#modules/relationships/service";

import { ImportRunFailuresService } from "./failure-service";
import {
	ProcessGenericImportChunksWorkflow,
	runProcessGenericImportChunksWorkflow,
} from "./generic-import-workflow";
import { ImportsService } from "./service";

it.effect("processes generic writes while preserving failures, progress, and chunk cleanup", () => {
	const executionId = "generic-import";
	const updates: Array<Record<string, unknown>> = [];
	const failures: Array<Record<string, unknown>> = [];
	const entities: Array<Record<string, unknown>> = [];
	const relationships: Array<Record<string, unknown>> = [];
	const eventExecutions: Array<Record<string, unknown>> = [];
	const directory = "/tmp/ryot-sandbox-harvest-test/generic-import-activity-0";
	const path = `${directory}/chunk-0.json`;
	const instance = WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, executionId);

	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(directory, { recursive: true });
		yield* fs.writeFileString(
			path,
			yield* Schema.encode(Schema.parseJson(Schema.Unknown))({
				failures: [
					{
						itemIndex: 0,
						sourceLabel: "Row 1",
						sourceIdentifier: "1",
						message: "Could not parse date/time value",
					},
				],
				items: [
					{
						itemIndex: 1,
						sourceIdentifier: "collection-1",
						sourceLabel: "Imported collection",
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
						],
						events: [
							{
								entityAlias: "existing",
								eventSchemaSlug: "review",
								sessionEntityAlias: "session",
								occurredAt: "2026-01-02T03:04:05.000Z",
								properties: { rating: 90, text: "Imported body", isSpoiler: false },
							},
						],
						relationships: [
							{
								sourceAlias: "session",
								targetAlias: "existing",
								properties: { rank: 7 },
								relationshipSchemaSlug: "member-of",
							},
						],
					},
				],
			}),
		);

		const result = yield* runProcessGenericImportChunksWorkflow(
			{
				executionId,
				totalItems: 2,
				failureCount: 1,
				writeItemCount: 1,
				chunkFiles: [path],
				userId: UserId.make("user-1"),
				runId: ImportRunId.make("run-1"),
				expectedHarvestDirectoryPrefix: "/tmp/ryot-sandbox-harvest-test/generic-import-activity-",
			},
			executionId,
		);

		expect(result).toEqual({ failedItems: 1, importedItems: 1, processedItems: 2 });
		expect(failures).toEqual([
			expect.objectContaining({
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse date/time value",
			}),
		]);
		expect(entities).toEqual([
			expect.objectContaining({
				userId: "user-1",
				name: "Created collection",
				entitySchemaSlug: "collection",
				properties: { kind: "session" },
			}),
		]);
		expect(relationships).toEqual([
			expect.objectContaining({
				properties: { rank: 7 },
				relationshipSchemaSlug: "member-of",
				sourceEntityId: "created-collection",
				targetEntityId: "existing-collection",
			}),
		]);
		expect(eventExecutions).toEqual([
			{
				executionId: "generic-import-item-1-events",
				payload: {
					origin: "import",
					userId: "user-1",
					importRunId: "run-1",
					executionId: "generic-import-item-1-events",
					lifecycleOrigin: { kind: "import", importRunId: "run-1" },
					payload: [
						{
							eventSchemaSlug: "review",
							entityId: "existing-collection",
							sessionEntityId: "created-collection",
							occurredAt: "2026-01-02T03:04:05.000Z",
							properties: { rating: 90, text: "Imported body", isSpoiler: false },
						},
					],
				},
			},
		]);
		expect(updates).toContainEqual(
			expect.objectContaining({
				progress: 100,
				failedItems: 1,
				importedItems: 1,
				processedItems: 2,
			}),
		);
		expect(yield* fs.exists(directory)).toBe(false);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (_workflow, options) =>
					Effect.sync(() => {
						eventExecutions.push(options);
						return [];
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				BunContext.layer,
				makeAppConfigLayer(),
				DefinitionRegistry.Default,
				Layer.mock(RelationshipsService)({
					_tag: "RelationshipsService",
					create: (input) =>
						Effect.sync(() => {
							relationships.push(input);
							assert(isObjectRecord(input.properties));
							return {
								wasInserted: true,
								properties: input.properties,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								createdAt: "2026-01-01T00:00:00.000Z",
								id: RelationshipId.make("relationship-1"),
								relationshipSchemaSlug: input.relationshipSchemaSlug,
							};
						}),
				}),
				Layer.mock(EntitiesRepository)({
					_tag: "EntitiesRepository",
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
						]),
				}),
				Layer.mock(EntitiesService)({
					_tag: "EntitiesService",
					create: (input) =>
						Effect.sync(() => {
							entities.push(input);
							assert(isObjectRecord(input.properties));
							return {
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
						}),
				}),
				Layer.mock(ImportsService)({
					_tag: "ImportsService",
					update: (input) => Effect.sync(() => updates.push(input)).pipe(Effect.asVoid),
				}),
				Layer.mock(ImportRunFailuresService)({
					_tag: "ImportRunFailuresService",
					create: (input) => Effect.sync(() => failures.push(input)).pipe(Effect.asVoid),
				}),
			),
		),
	);
});

it.effect("cleans trusted activity directories when the initial run update fails", () => {
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
					chunkFiles: [path],
					userId: UserId.make("user-1"),
					runId: ImportRunId.make("run-update-failure"),
					expectedHarvestDirectoryPrefix: `/tmp/ryot-sandbox-harvest-test/${executionId}-activity-`,
				},
				executionId,
			),
		);

		expect(exit._tag).toBe("Failure");
		expect(yield* fs.exists(directory)).toBe(false);
	}).pipe(
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				BunContext.layer,
				DefinitionRegistry.Default,
				Layer.mock(RelationshipsService)({ _tag: "RelationshipsService" }),
				Layer.mock(EntitiesRepository)({ _tag: "EntitiesRepository" }),
				Layer.mock(EntitiesService)({ _tag: "EntitiesService" }),
				Layer.mock(ImportRunFailuresService)({ _tag: "ImportRunFailuresService" }),
				Layer.mock(ImportsService)({
					_tag: "ImportsService",
					update: () => Effect.fail(new DbError({ message: "initial update failed" })),
				}),
			),
		),
	);
});

it.effect("rejects another parent execution's chunks without cleaning untrusted paths", () => {
	const executionId = "generic-import-provenance";
	const trustedDirectory = `/tmp/ryot-sandbox-harvest-test/${executionId}-activity-0`;
	const untrustedDirectory = "/tmp/ryot-sandbox-harvest-test/other-parent-activity-0";
	const trustedPath = `${trustedDirectory}/chunk-0.json`;
	const untrustedPath = `${untrustedDirectory}/chunk-0.json`;
	const instance = WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, executionId);

	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* fs.makeDirectory(trustedDirectory, { recursive: true });
		yield* fs.makeDirectory(untrustedDirectory, { recursive: true });
		const emptyChunk = yield* Schema.encode(Schema.parseJson(Schema.Unknown))({
			failures: [],
			items: [],
		});
		yield* fs.writeFileString(trustedPath, emptyChunk);
		yield* fs.writeFileString(untrustedPath, emptyChunk);

		const exit = yield* Effect.exit(
			runProcessGenericImportChunksWorkflow(
				{
					executionId,
					totalItems: 0,
					failureCount: 0,
					writeItemCount: 0,
					userId: UserId.make("user-1"),
					chunkFiles: [trustedPath, untrustedPath],
					runId: ImportRunId.make("run-provenance"),
					expectedHarvestDirectoryPrefix: `/tmp/ryot-sandbox-harvest-test/${executionId}-activity-`,
				},
				executionId,
			),
		);

		expect(exit.toString()).toContain("Import chunk path is outside the trusted harvest");
		expect(yield* fs.exists(trustedDirectory)).toBe(false);
		expect(yield* fs.exists(untrustedPath)).toBe(true);
		yield* fs.remove(untrustedDirectory, { recursive: true });
	}).pipe(
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				BunContext.layer,
				DefinitionRegistry.Default,
				Layer.mock(RelationshipsService)({ _tag: "RelationshipsService" }),
				Layer.mock(EntitiesRepository)({ _tag: "EntitiesRepository" }),
				Layer.mock(EntitiesService)({ _tag: "EntitiesService" }),
				Layer.mock(ImportRunFailuresService)({ _tag: "ImportRunFailuresService" }),
				Layer.mock(ImportsService)({ _tag: "ImportsService", update: () => Effect.void }),
			),
		),
	);
});
