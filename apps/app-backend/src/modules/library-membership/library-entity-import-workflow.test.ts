import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-support/effect";
import { makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { CollectionsService } from "#modules/collections/service";
import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";

import { runLibraryEntityImportWorkflow } from "./library-entity-import-workflow";

const TestLibraryEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "TestLibraryEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const now = "2026-06-14T00:00:00.000Z";

const populatedEntity = {
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	name: "Test Book",
	externalId: "ext-1",
	sandboxScriptId: null,
	id: EntityId.make("entity-1"),
	properties: { title: "Test Book" },
	entitySchemaId: EntitySchemaId.make("schema-1"),
} satisfies ListedEntity;

const importPayload = {
	externalId: "ext-1",
	executionId: "exec-1",
	userId: UserId.make("user-1"),
	scriptId: SandboxScriptId.make("script-1"),
	entitySchemaId: EntitySchemaId.make("schema-1"),
} satisfies EntityImportPayload;

type PopulationStub = (
	...args: Parameters<WorkflowEngine["Type"]["execute"]>
) => Effect.Effect<unknown, unknown>;

type TestLayerOptions = {
	population?: PopulationStub;
	collectionsService?: Layer.Layer<CollectionsService>;
};

const mockCollectionsService = Layer.mock(CollectionsService);

const makeCollectionsService = (overrides: MockOverrides<typeof mockCollectionsService> = {}) =>
	mockCollectionsService({ ...overrides, _tag: "CollectionsService" });

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(TestLibraryEntityImportWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: options.population ?? (() => Effect.succeed(populatedEntity)),
	});

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(options.collectionsService ?? makeCollectionsService()),
	);
};

it.effect("awaits provider population then ensures library membership", () => {
	let ensuredCall: { userId: string; entityId: string } | undefined;
	const populationCalls: unknown[] = [];

	const options = {
		population: (_workflow, execOptions) => {
			populationCalls.push(execOptions);
			return Effect.succeed(populatedEntity);
		},
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: (userId, entityId) => {
				ensuredCall = { userId, entityId };
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		importPayload.executionId,
		Effect.gen(function* () {
			const entity = yield* runLibraryEntityImportWorkflow(
				importPayload,
				importPayload.executionId,
			);

			expect(entity.id).toBe("entity-1");
			expect(ensuredCall).toEqual({ userId: "user-1", entityId: "entity-1" });
			expect(populationCalls).toMatchObject([
				{
					payload: { mode: "ensure" },
					executionId: `${importPayload.executionId}-provider-population`,
				},
			]);
		}),
	);
});

it.effect("does not ensure library membership when provider population fails", () => {
	let ensureCalled = false;

	const options = {
		population: () => Effect.fail(new SandboxRunError({ message: "provider boom" })),
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => {
				ensureCalled = true;
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		importPayload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runLibraryEntityImportWorkflow(importPayload, importPayload.executionId),
			);

			expect(ensureCalled).toBe(false);
			expect(exit._tag).toBe("Failure");
		}),
	);
});

it.effect("dies when the payload has no userId", () => {
	let ensureCalled = false;

	const options = {
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => {
				ensureCalled = true;
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	const payload = { ...importPayload, userId: null };

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runLibraryEntityImportWorkflow(payload, payload.executionId));

			expect(ensureCalled).toBe(false);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure" && exit.cause._tag === "Die") {
				expect(exit.cause.defect).toBe("LibraryEntityImportWorkflow: userId is required");
			}
		}),
	);
});
