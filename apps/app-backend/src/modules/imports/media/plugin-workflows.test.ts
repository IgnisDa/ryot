import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import {
	EntitySchemaSlug,
	ImportRunId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Layer, Option, Redacted } from "effect";
import { assert } from "vitest";

import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { makeAppConfigLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { ImportRunFailuresService } from "#modules/imports/failure-service";
import { ImportsService } from "#modules/imports/service";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ProcessNormalizedMediaImportWorkflow } from "./normalized-import-workflow";
import {
	populateMediaEntityGroupsWithPlugin,
	resolveMediaEntityGroupsWithPlugin,
} from "./plugin-workflows";
import type { ImportMediaEntityGroup } from "./types";
import { MediaImportWorkflowOperations } from "./types-workflow";

const runId = ImportRunId.make("scale-run");
const userId = UserId.make("scale-user");
const resolutionScriptId = SandboxScriptId.make("workflow.media-import-resolution");
const populationScriptId = SandboxScriptId.make("workflow.media-import-population");

const inputItems = (input: { input: unknown }) => {
	assert(isObjectRecord(input.input));
	const items = input.input["items"];
	assert(Array.isArray(items));
	return items;
};

const makeLayer = (
	sandbox: Layer.Layer<SandboxExecutionService>,
	config = makeAppConfigLayer(),
	failures = Layer.mock(ImportRunFailuresService)({
		_tag: "ImportRunFailuresService",
		create: () => Effect.void,
	}),
) => {
	const executionId = "media-import-scale";
	const instance = WorkflowInstance.initial(ProcessNormalizedMediaImportWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);
	return {
		executionId,
		layer: Layer.mergeAll(
			config,
			sandbox,
			Layer.succeed(WorkflowEngine, engine),
			Layer.succeed(WorkflowInstance, instance),
			failures,
			Layer.mock(MediaImportWorkflowOperations)({
				resolveProvider: () =>
					Effect.succeed({
						providerId: SandboxProviderId.make("provider-openlibrary"),
						entitySchemaSlug: EntitySchemaSlug.make("book"),
					}),
			}),
			Layer.mock(ImportsService)({
				_tag: "ImportsService",
				update: () => Effect.void,
			}),
		),
	};
};

it.effect(
	"chunks a thousand population items within context and step limits with bounded overlap",
	() => {
		const calls: Array<{ executionId: string; items: unknown[] }> = [];
		let active = 0;
		let maxActive = 0;
		let resolveCount = 0;
		const sandbox = Layer.mock(SandboxExecutionService)({
			_tag: "SandboxExecutionService",
			resolveWorkflowScript: () =>
				Effect.sync(() => {
					resolveCount += 1;
					return populationScriptId;
				}),
			executeWorkflow: (input) =>
				Effect.gen(function* () {
					active += 1;
					maxActive = Math.max(maxActive, active);
					yield* Effect.yieldNow();
					const items = inputItems(input);
					calls.push({ items, executionId: input.executionId });
					active -= 1;
					return {
						results: items.map((item) => {
							assert(isObjectRecord(item));
							assert(typeof item["index"] === "number");
							return {
								index: item["index"],
								status: "completed" as const,
								entityId: `entity-${item["index"]}`,
							};
						}),
					};
				}),
		});
		const { executionId, layer } = makeLayer(sandbox);
		const entityGroups: ImportMediaEntityGroup[] = Array.from({ length: 1_001 }, (_, index) => ({
			events: [],
			itemIndex: index,
			collectionMemberships: [],
			entityRef: {
				kind: "resolved",
				entitySchemaSlug: "book",
				sourceLabel: `Book ${index}`,
				externalId: `external-${index}`,
				providerSlug: "book.openlibrary",
			},
		}));

		return Effect.gen(function* () {
			const result = yield* populateMediaEntityGroupsWithPlugin({
				entityGroups,
				executionId,
				payload: { runId, userId },
				reportProgress: () => Effect.void,
			});

			expect(resolveCount).toBe(1);
			expect(calls.length).toBeGreaterThan(1);
			expect(maxActive).toBeGreaterThan(1);
			expect(maxActive).toBeLessThanOrEqual(5);
			expect(result.entityIdsByKey.size).toBe(1_001);
			expect(calls.map(({ executionId: callExecutionId }) => callExecutionId)).toEqual(
				calls.map((_call, index) => `${executionId}-population-chunk-${index}`),
			);
			for (const call of calls) {
				expect(call.items.length).toBeLessThanOrEqual(1_000);
				expect(sandboxContextError({ items: call.items }, { kind: "workflow" })).toBeNull();
			}
		}).pipe(Effect.provide(layer));
	},
);

it.effect("chunks three-candidate resolution by worst-case durable steps", () => {
	const calls: Array<{ executionId: string; items: unknown[] }> = [];
	let resolveCount = 0;
	const sandbox = Layer.mock(SandboxExecutionService)({
		_tag: "SandboxExecutionService",
		resolveWorkflowScript: () =>
			Effect.sync(() => {
				resolveCount += 1;
				return resolutionScriptId;
			}),
		executeWorkflow: (input) =>
			Effect.sync(() => {
				const items = inputItems(input);
				calls.push({ items, executionId: input.executionId });
				return {
					results: items.map((item) => {
						assert(isObjectRecord(item));
						assert(typeof item["index"] === "number");
						return {
							index: item["index"],
							status: "resolved" as const,
							providerSlug: "book.openlibrary",
							externalId: `resolved-${item["index"]}`,
						};
					}),
				};
			}),
	});
	const config = makeAppConfigLayer({
		books: {
			hardcoverApiKey: Option.some(Redacted.make("hardcover")),
			googleBooksApiKey: Option.some(Redacted.make("google-books")),
		},
	});
	const { executionId, layer } = makeLayer(sandbox, config);
	const entityGroups: ImportMediaEntityGroup[] = Array.from({ length: 400 }, (_, index) => ({
		events: [],
		itemIndex: index,
		collectionMemberships: [],
		entityRef: {
			kind: "unresolved",
			identifierType: "isbn",
			entitySchemaSlug: "book",
			sourceLabel: `Book ${index}`,
			identifierValue: `9780000${String(index).padStart(6, "0")}`,
		},
	}));

	return Effect.gen(function* () {
		expect(
			yield* resolveMediaEntityGroupsWithPlugin({
				entityGroups,
				executionId,
				payload: { runId, userId },
				reportProgress: () => Effect.void,
			}),
		).toBe(0);

		expect(resolveCount).toBe(1);
		expect(calls.length).toBeGreaterThan(1);
		expect(calls.map(({ executionId: callExecutionId }) => callExecutionId)).toEqual(
			calls.map((_call, index) => `${executionId}-resolution-chunk-${index}`),
		);
		for (const call of calls) {
			const steps = call.items.reduce<number>((total, item) => {
				assert(isObjectRecord(item));
				assert(Array.isArray(item["candidates"]));
				return total + item["candidates"].length;
			}, 0);
			expect(steps).toBeLessThanOrEqual(1_000);
			expect(sandboxContextError({ items: call.items }, { kind: "workflow" })).toBeNull();
		}
		expect(entityGroups.every(({ entityRef }) => entityRef.kind === "resolved")).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("isolates malformed output to one population chunk", () => {
	const chunkSizes: number[] = [];
	const recordedFailures: Array<Record<string, unknown>> = [];
	const sandbox = Layer.mock(SandboxExecutionService)({
		_tag: "SandboxExecutionService",
		resolveWorkflowScript: () => Effect.succeed(populationScriptId),
		executeWorkflow: (input) => {
			const items = inputItems(input);
			const chunkIndex = chunkSizes.length;
			chunkSizes.push(items.length);
			return Effect.succeed({
				results:
					chunkIndex === 0
						? []
						: items.map((item) => {
								assert(isObjectRecord(item));
								assert(typeof item["index"] === "number");
								return {
									index: item["index"],
									status: "completed" as const,
									entityId: `entity-${item["index"]}`,
								};
							}),
			});
		},
	});
	const failureLayer = Layer.mock(ImportRunFailuresService)({
		_tag: "ImportRunFailuresService",
		create: (input) =>
			Effect.sync(() => {
				recordedFailures.push(input);
			}),
	});
	const { executionId, layer } = makeLayer(sandbox, makeAppConfigLayer(), failureLayer);
	const entityGroups: ImportMediaEntityGroup[] = Array.from({ length: 1_001 }, (_, index) => ({
		events: [],
		itemIndex: index,
		collectionMemberships: [],
		entityRef: {
			kind: "resolved",
			entitySchemaSlug: "book",
			sourceLabel: `Book ${index}`,
			externalId: `external-${index}`,
			providerSlug: "book.openlibrary",
		},
	}));

	return Effect.gen(function* () {
		const result = yield* populateMediaEntityGroupsWithPlugin({
			entityGroups,
			executionId,
			payload: { runId, userId },
			reportProgress: () => Effect.void,
		});

		expect(chunkSizes.length).toBeGreaterThan(1);
		expect(recordedFailures).toHaveLength(chunkSizes[0] ?? 0);
		expect(result.failures).toBe(chunkSizes[0]);
		expect(result.entityIdsByKey.size).toBe(1_001 - (chunkSizes[0] ?? 0));
		expect(recordedFailures[0]).toEqual(
			expect.objectContaining({ message: expect.stringContaining("returned malformed results") }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("records an oversized resolution item without failing later chunks", () => {
	const recordedFailures: Array<Record<string, unknown>> = [];
	const sandbox = Layer.mock(SandboxExecutionService)({
		_tag: "SandboxExecutionService",
		resolveWorkflowScript: () => Effect.succeed(resolutionScriptId),
		executeWorkflow: (input) => {
			const items = inputItems(input);
			return Effect.succeed({
				results: items.map((item) => {
					assert(isObjectRecord(item));
					assert(typeof item["index"] === "number");
					return {
						index: item["index"],
						status: "resolved" as const,
						externalId: "resolved-valid",
						providerSlug: "book.openlibrary",
					};
				}),
			});
		},
	});
	const failures = Layer.mock(ImportRunFailuresService)({
		_tag: "ImportRunFailuresService",
		create: (input) =>
			Effect.sync(() => {
				recordedFailures.push(input);
			}),
	});
	const { executionId, layer } = makeLayer(sandbox, makeAppConfigLayer(), failures);
	const entityGroups: ImportMediaEntityGroup[] = [
		{
			events: [],
			itemIndex: 0,
			collectionMemberships: [],
			entityRef: {
				kind: "unresolved",
				identifierType: "isbn",
				entitySchemaSlug: "book",
				sourceLabel: "Oversized",
				identifierValue: "x".repeat(70 * 1024),
			},
		},
		{
			events: [],
			itemIndex: 1,
			collectionMemberships: [],
			entityRef: {
				kind: "unresolved",
				sourceLabel: "Valid",
				identifierType: "isbn",
				entitySchemaSlug: "book",
				identifierValue: "9780000000001",
			},
		},
	];

	return Effect.gen(function* () {
		expect(
			yield* resolveMediaEntityGroupsWithPlugin({
				entityGroups,
				executionId,
				payload: { runId, userId },
				reportProgress: () => Effect.void,
			}),
		).toBe(1);

		expect(recordedFailures).toEqual([
			expect.objectContaining({
				itemIndex: 0,
				stage: "provider_resolution",
				message: "Media import resolution workflow item exceeds the workflow context limit",
			}),
		]);
		expect(entityGroups[0]?.entityRef.kind).toBe("unresolved");
		expect(entityGroups[1]?.entityRef.kind).toBe("resolved");
	}).pipe(Effect.provide(layer));
});

it.effect("keeps sandbox infrastructure failures fatal", () => {
	const sandbox = Layer.mock(SandboxExecutionService)({
		_tag: "SandboxExecutionService",
		resolveWorkflowScript: () => Effect.succeed(populationScriptId),
		executeWorkflow: () =>
			Effect.fail(new SandboxRunError({ message: "chunk infrastructure failed" })),
	});
	const { executionId, layer } = makeLayer(sandbox);
	const entityGroups: ImportMediaEntityGroup[] = [
		{
			events: [],
			itemIndex: 0,
			collectionMemberships: [],
			entityRef: {
				kind: "resolved",
				sourceLabel: "Book 0",
				entitySchemaSlug: "book",
				externalId: "external-0",
				providerSlug: "book.openlibrary",
			},
		},
	];

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			populateMediaEntityGroupsWithPlugin({
				executionId,
				entityGroups,
				payload: { runId, userId },
				reportProgress: () => Effect.void,
			}),
		);

		expect(error.message).toContain("chunk infrastructure failed");
	}).pipe(Effect.provide(layer));
});
