import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides, WorkflowEngineOverrides } from "#lib/test-support/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runOneTimeMediaImportWorkflow } from "./media-workflow";
import {
	MediaImportWorkflowOperations,
	type MediaImportWorkflowOperationsValue,
} from "./media/types-workflow";
import { loadImportAdapterResult } from "./runtime/source-payload-store";
import { ImportRunError } from "./runtime/workflow-errors";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

const mockImportsService = Layer.mock(ImportsService);
const mockImportRunArtifacts = Layer.mock(ImportRunArtifacts);

const makeImportsService = (overrides: MockOverrides<typeof mockImportsService> = {}) =>
	mockImportsService({
		update: () => Effect.void,
		...overrides,
		_tag: "ImportsService",
	});

const makeMediaOperations = (overrides: Partial<MediaImportWorkflowOperationsValue> = {}) =>
	Layer.mock(MediaImportWorkflowOperations, overrides);

const makeImportRunArtifacts = (
	cleanupArtifacts: NonNullable<
		MockOverrides<typeof mockImportRunArtifacts>["cleanupArtifacts"]
	> = () => Effect.void,
) =>
	mockImportRunArtifacts({
		cleanupArtifacts,
		_tag: "ImportRunArtifacts",
	});

const makeRedisLayer = () => {
	const store = new Map<string, string>();
	return Layer.succeed(
		RedisService,
		makeRedisService({
			get: (key) => Effect.succeed(store.get(key) ?? null),
			set: (key, value) =>
				Effect.sync(() => {
					store.set(key, value);
				}),
			del: (...keys) =>
				Effect.sync(() => {
					let removed = 0;
					for (const key of keys) {
						if (store.delete(key)) {
							removed += 1;
						}
					}
					return removed;
				}),
		}),
	);
};

type TestLayerOptions = {
	importsService?: Layer.Layer<ImportsService>;
	importRunArtifacts?: Layer.Layer<ImportRunArtifacts>;
	mediaOperations?: Layer.Layer<MediaImportWorkflowOperations>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		makeAppConfigLayer(),
		BunFileSystem.layer,
		makeRedisLayer(),
		options.importRunArtifacts ?? makeImportRunArtifacts(),
		options.mediaOperations ?? makeMediaOperations(),
		options.importsService ?? makeImportsService(),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
	engineOverrides: WorkflowEngineOverrides = {},
) => {
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, engineOverrides);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const importPayload = {
	userId: UserId.make("user-1"),
	source: "goodreads",
	filePath: "/tmp/import.csv",
	sourcePayloadKey: "payload-1",
	runId: ImportRunId.make("run-1"),
};

const loadedAdapterResult = {
	cleanupPaths: ["/tmp/import.csv"],
	adapterResult: {
		failures: [{ itemIndex: 0, message: "Bad source row" }],
		entityGroups: [
			{
				itemIndex: 1,
				collectionMemberships: [],
				events: [],
				entityRef: {
					kind: "unresolved" as const,
					identifierType: "isbn",
					sourceLabel: "Book One",
					entitySchemaSlug: "book",
					identifierValue: "9781234567890",
				},
			},
		],
	},
};

it.effect("persists the adapter result and dispatches the normalized child workflow", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const childDispatches: Array<Record<string, unknown>> = [];

	const options = {
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
			loadAdapterResult: () => Effect.succeed(loadedAdapterResult),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-1",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-1");

			expect(childDispatches).toHaveLength(1);
			expect(childDispatches[0]).toMatchObject({
				executionId: "workflow-1-normalized",
				payload: {
					runId: "run-1",
					userId: "user-1",
					executionId: "workflow-1-normalized",
				},
			});

			const stored = yield* loadImportAdapterResult("run-1");
			expect(stored?.entityGroups).toHaveLength(1);
			expect(stored?.failures).toHaveLength(1);

			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({ runId: "run-1", status: "running" }),
			);
			expect(cleanupCalls).toEqual([
				{ cleanupPaths: ["/tmp/import.csv"], runId: "run-1", sourcePayloadKey: "payload-1" },
			]);
		}),
		{
			execute: (_workflow, dispatch) =>
				Effect.sync(() => {
					childDispatches.push({ executionId: dispatch.executionId, payload: dispatch.payload });
					return undefined;
				}),
		},
	);
});

it.effect("fails the run and cleans up when the normalized child workflow fails", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];

	const options = {
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
			loadAdapterResult: () => Effect.succeed(loadedAdapterResult),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-child-failure",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(importPayload, "workflow-child-failure");

			expect(cleanupCalls).toEqual([
				{ cleanupPaths: ["/tmp/import.csv"], runId: "run-1", sourcePayloadKey: "payload-1" },
			]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "child boom",
				}),
			);
		}),
		{
			execute: () => Effect.fail(new ImportRunError({ message: "child boom" })),
		},
	);
});

it.effect(
	"fails the run and cleans up artifacts when adapter loading fails catastrophically",
	() => {
		let childDispatched = false;
		const cleanupCalls: Array<Record<string, unknown>> = [];
		const recordedUpdates: Array<Record<string, unknown>> = [];
		const defectPayload = { ...importPayload, filePath: "/tmp/import.csv" };

		const options = {
			importsService: makeImportsService({
				update: (input) => {
					recordedUpdates.push(input);
					return Effect.void;
				},
			}),
			importRunArtifacts: makeImportRunArtifacts((input) =>
				Effect.sync(() => {
					cleanupCalls.push(input);
				}),
			),
			mediaOperations: makeMediaOperations({
				loadAdapterResult: () => Effect.die("Source credentials failed"),
			}),
		} satisfies TestLayerOptions;

		return withTestLayer(
			options,
			"workflow-failure",
			Effect.gen(function* () {
				yield* runOneTimeMediaImportWorkflow(defectPayload, "workflow-failure");

				expect(childDispatched).toBe(false);
				expect(cleanupCalls).toEqual([
					{ cleanupPaths: [defectPayload.filePath], runId: "run-1", sourcePayloadKey: "payload-1" },
				]);
				expect(recordedUpdates).toContainEqual(
					expect.objectContaining({ runId: "run-1", status: "running" }),
				);
				expect(recordedUpdates).toContainEqual(
					expect.objectContaining({
						runId: "run-1",
						status: "failed",
						errorSummary: "Source credentials failed",
					}),
				);
			}),
			{
				execute: () =>
					Effect.sync(() => {
						childDispatched = true;
						return undefined;
					}),
			},
		);
	},
);

it.effect("does not reintroduce invalid file paths during handled load failures", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const invalidPayload = { ...importPayload, filePath: "../../etc/passwd" };

	const options = {
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
			loadAdapterResult: () =>
				Effect.fail({ cleanupPaths: [], message: "Import job has an invalid file path" }),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-invalid-load-path",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(invalidPayload, "workflow-invalid-load-path");

			expect(cleanupCalls).toEqual([
				{ cleanupPaths: [], runId: "run-1", sourcePayloadKey: "payload-1" },
			]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Import job has an invalid file path",
				}),
			);
		}),
	);
});

it.effect("does not attempt cleanup for invalid file paths when adapter loading defects", () => {
	const cleanupCalls: Array<Record<string, unknown>> = [];
	const recordedUpdates: Array<Record<string, unknown>> = [];
	const invalidPayload = { ...importPayload, filePath: "../../etc/passwd" };

	const options = {
		importsService: makeImportsService({
			update: (input) => {
				recordedUpdates.push(input);
				return Effect.void;
			},
		}),
		importRunArtifacts: makeImportRunArtifacts((input) =>
			Effect.sync(() => {
				cleanupCalls.push(input);
			}),
		),
		mediaOperations: makeMediaOperations({
			loadAdapterResult: () => Effect.die("Source credentials failed"),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		"workflow-invalid-load-path-defect",
		Effect.gen(function* () {
			yield* runOneTimeMediaImportWorkflow(invalidPayload, "workflow-invalid-load-path-defect");

			expect(cleanupCalls).toEqual([
				{ cleanupPaths: [], runId: "run-1", sourcePayloadKey: "payload-1" },
			]);
			expect(recordedUpdates).toContainEqual(
				expect.objectContaining({
					runId: "run-1",
					status: "failed",
					errorSummary: "Source credentials failed",
				}),
			);
		}),
	);
});
