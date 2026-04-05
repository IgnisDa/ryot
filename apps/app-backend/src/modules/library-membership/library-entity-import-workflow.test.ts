import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError, SandboxRunError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";

import {
	LibraryEntityImportError,
	runLibraryEntityImportWorkflow,
} from "./library-entity-import-workflow";
import { LibraryEntityImportWorkflowOperations } from "./operations-workflow";

const TestLibraryEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: LibraryEntityImportError,
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
	providerId: SandboxProviderId.make("provider-1"),
	id: EntityId.make("entity-1"),
	properties: { title: "Test Book" },
	entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
} satisfies ListedEntity;

const importPayload = {
	externalId: "ext-1",
	executionId: "exec-1",
	userId: UserId.make("user-1"),
	origin: { kind: "api" } as const,
	providerId: SandboxProviderId.make("provider-1"),
	entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
} satisfies EntityImportPayload;

type PopulationStub = (
	...args: Parameters<WorkflowEngine["Type"]["execute"]>
) => Effect.Effect<unknown, unknown>;

type EnsureMembershipStub =
	LibraryEntityImportWorkflowOperations["Type"]["ensureLibraryMembership"];

type TestLayerOptions = {
	population?: PopulationStub;
	ensureLibraryMembership?: EnsureMembershipStub;
};

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
		Effect.provide(
			Layer.mock(LibraryEntityImportWorkflowOperations, {
				ensureLibraryMembership: options.ensureLibraryMembership ?? (() => Effect.void),
			}),
		),
	);
};

it.effect("awaits provider population then dispatches the membership queue", () => {
	let ensuredCall: { userId: string; entityId: string; executionId: string } | undefined;
	const populationCalls: unknown[] = [];

	const options = {
		population: (_workflow, execOptions) => {
			populationCalls.push(execOptions);
			return Effect.succeed(populatedEntity);
		},
		ensureLibraryMembership: (input) => {
			ensuredCall = {
				userId: input.userId,
				entityId: input.entityId,
				executionId: input.executionId,
			};
			return Effect.void;
		},
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
			expect(ensuredCall).toEqual({
				userId: "user-1",
				entityId: "entity-1",
				executionId: `${importPayload.executionId}-membership`,
			});
			expect(populationCalls).toMatchObject([
				{
					payload: { mode: "ensure", providerId: "provider-1" },
					executionId: `${importPayload.executionId}-provider-population`,
				},
			]);
		}),
	);
});

it.effect("does not dispatch library membership when provider population fails", () => {
	let ensureCalled = false;

	const options = {
		population: () => Effect.fail(new SandboxRunError({ message: "provider boom" })),
		ensureLibraryMembership: () => {
			ensureCalled = true;
			return Effect.void;
		},
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
			if (exit._tag === "Failure") {
				const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
				expect(error).toBeInstanceOf(LibraryEntityImportError);
				expect(error?.stage).toBe("population");
				expect(error?.message).toBe("provider boom");
			}
		}),
	);
});

it.effect("surfaces a membership-stage failure when the queue dispatch fails", () => {
	const options = {
		ensureLibraryMembership: () => Effect.fail(new DbError({ message: "membership boom" })),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		importPayload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runLibraryEntityImportWorkflow(importPayload, importPayload.executionId),
			);

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const error = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
				expect(error).toBeInstanceOf(LibraryEntityImportError);
				expect(error?.stage).toBe("membership");
				expect(error?.message).toBe("membership boom");
			}
		}),
	);
});

it.effect("dies when the payload has no userId", () => {
	let ensureCalled = false;

	const options = {
		ensureLibraryMembership: () => {
			ensureCalled = true;
			return Effect.void;
		},
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
