import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Cause, Effect, Fiber } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import {
	getProviderImportExecutingBodies,
	getProviderImportPhaseSegments,
} from "#lib/infrastructure/runtime-metrics";
import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import {
	EntityImportError,
	EntityImportWorkflow,
	runEntityImportWorkflow,
} from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";

const importCommand = (executionId: string, userId: UserId) =>
	rootLifecycleCommand({
		source: "import",
		initiator: { id: userId, kind: "user" },
		itemIdentity: `provider-import:${executionId}`,
		executionId: AutomationExecutionId.make(executionId),
		occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
	});

const importWithoutMembership = (entitySchemaSlug: string) => {
	const executionId = `${entitySchemaSlug}-import`;
	const calls: Array<{ name: string; options: Record<string, unknown> }> = [];
	const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
	const entity = {
		properties: {},
		name: "Fixture",
		externalId: "external-1",
		id: EntityId.make("fixture-1"),
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		populatedAt: "2026-01-01T00:00:00.000Z",
		providerId: SandboxProviderId.make("provider-1"),
		entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
	};

	return Effect.gen(function* () {
		const userId = UserId.make("user-1");
		const result = yield* runEntityImportWorkflow(
			{
				executionId,
				externalId: "external-1",
				entityScope: { userId, type: "global" },
				command: importCommand(executionId, userId),
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make(entitySchemaSlug),
			},
			executionId,
		);

		expect(result).toEqual(entity);
		expect(calls).toEqual([
			expect.objectContaining({
				name: "ProviderEntityPopulationWorkflow",
				options: expect.objectContaining({ executionId: `${executionId}-provider-population` }),
			}),
			{ options: { executionId }, name: "provider-import-completion" },
		]);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) =>
					Effect.sync(() => {
						calls.push({ options, name: workflow._tag });
						return entity;
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(EntityImportWorkflowOperations, {
			processSandbox: () => Effect.die("unused"),
			processProviderResolve: () => Effect.die("unused"),
			completeProviderEntityImport: (_payload, _entity, hookExecutionId) =>
				Effect.sync(() => {
					calls.push({
						name: "provider-import-completion",
						options: { executionId: hookExecutionId },
					});
				}),
		}),
	);
};

it.effect("runs provider-import completion after provider population", () =>
	importWithoutMembership("unrelated-fixture"),
);

it.effect("imports a sample entity without example membership work", () =>
	importWithoutMembership("routine"),
);

it.effect("fails the import when provider-import completion fails", () => {
	const executionId = "failed-import";
	const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
	const entity = {
		properties: {},
		name: "Fixture",
		externalId: "external-1",
		id: EntityId.make("fixture-1"),
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		populatedAt: "2026-01-01T00:00:00.000Z",
		providerId: SandboxProviderId.make("provider-1"),
		entitySchemaSlug: EntitySchemaSlug.make("record"),
	};

	return Effect.gen(function* () {
		const userId = UserId.make("user-1");
		const error = yield* Effect.flip(
			runEntityImportWorkflow(
				{
					executionId,
					externalId: "external-1",
					entityScope: { userId, type: "global" },
					command: importCommand(executionId, userId),
					providerId: SandboxProviderId.make("provider-1"),
					entitySchemaSlug: EntitySchemaSlug.make("record"),
				},
				executionId,
			),
		);
		expect(error).toBeInstanceOf(EntityImportError);
		expect(error).toMatchObject({
			message: "membership hook failed",
			stage: "provider-import-automation",
		});
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, { execute: () => Effect.succeed(entity) }),
		),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(EntityImportWorkflowOperations, {
			processSandbox: () => Effect.die("unused"),
			processProviderResolve: () => Effect.die("unused"),
			completeProviderEntityImport: () =>
				Effect.fail(
					new SandboxRunError({ kind: "script-failure", message: "membership hook failed" }),
				),
		}),
	);
});

it.effect(
	"records a suspended body and its replay as separate attempts without growing the gauge",
	() => {
		const executionId = "replayed-import";
		const userId = UserId.make("user-1");
		const entity = {
			properties: {},
			name: "Fixture",
			externalId: "external-1",
			id: EntityId.make("fixture-1"),
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			populatedAt: "2026-01-01T00:00:00.000Z",
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		};
		const payload = {
			executionId,
			externalId: "external-1",
			command: importCommand(executionId, userId),
			entityScope: { userId, type: "global" as const },
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		};
		let populationReady = false;
		const runBody = () => {
			const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
			return runEntityImportWorkflow(payload, executionId).pipe(
				Effect.provideService(
					WorkflowEngine,
					makeWorkflowActivityEngine(instance, {
						execute: () => (populationReady ? Effect.succeed(entity) : Workflow.suspend(instance)),
					}),
				),
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(EntityImportWorkflowOperations, {
					processSandbox: () => Effect.die("unused"),
					completeProviderEntityImport: () => Effect.void,
					processProviderResolve: () => Effect.die("unused"),
				}),
			);
		};

		return Effect.gen(function* () {
			const baselineSequence = getProviderImportPhaseSegments(0).at(-1)?.sequence ?? 0;
			const baselineBodies = getProviderImportExecutingBodies();

			// The suspension interrupts the body's own fiber, so the attempt runs in a child fiber.
			const suspended = yield* Fiber.await(yield* Effect.forkChild(runBody()));
			expect(suspended._tag === "Failure" && Cause.hasInterruptsOnly(suspended.cause)).toBe(true);
			expect(getProviderImportExecutingBodies()).toBe(baselineBodies);

			populationReady = true;
			expect(yield* runBody()).toEqual(entity);
			expect(getProviderImportExecutingBodies()).toBe(baselineBodies);

			expect(
				getProviderImportPhaseSegments(baselineSequence)
					.filter((segment) => segment.executionId === executionId)
					.map(({ phase, outcome }) => ({ phase, outcome })),
			).toEqual([
				{ phase: "population", outcome: "interrupted" },
				{ outcome: "success", phase: "population" },
				{ outcome: "success", phase: "provider-import-automation" },
			]);
		});
	},
);
