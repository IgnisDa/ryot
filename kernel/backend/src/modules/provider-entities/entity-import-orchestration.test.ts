import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import {
	EntityImportError,
	EntityImportWorkflow,
	runEntityImportWorkflow,
} from "./entity-import-workflow";
import { EntityImportWorkflowOperations } from "./operations-workflow";

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
		const result = yield* runEntityImportWorkflow(
			{
				executionId,
				externalId: "external-1",
				origin: { kind: "import" },
				entityScope: { type: "global", userId: UserId.make("user-1") },
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
			{ name: "provider-import-automation", options: { executionId } },
		]);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) =>
					Effect.sync(() => {
						calls.push({ name: workflow._tag, options });
						return entity;
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(EntityImportWorkflowOperations, {
			processSandbox: () => Effect.die("unused"),
			runProviderImportAutomations: (_payload, _entity, hookExecutionId) =>
				Effect.sync(() => {
					calls.push({
						name: "provider-import-automation",
						options: { executionId: hookExecutionId },
					});
				}),
		}),
	);
};

it.effect("runs provider-import automations after provider population", () =>
	importWithoutMembership("unrelated-fixture"),
);

it.effect("imports a sample entity without example membership work", () =>
	importWithoutMembership("routine"),
);

it.effect("fails the import when a provider-import automation fails", () => {
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
		entitySchemaSlug: EntitySchemaSlug.make("record"),
		providerId: SandboxProviderId.make("provider-1"),
	};

	return Effect.gen(function* () {
		const error = yield* Effect.flip(
			runEntityImportWorkflow(
				{
					executionId,
					externalId: "external-1",
					origin: { kind: "import" },
					entityScope: { type: "global", userId: UserId.make("user-1") },
					entitySchemaSlug: EntitySchemaSlug.make("record"),
					providerId: SandboxProviderId.make("provider-1"),
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
			runProviderImportAutomations: () =>
				Effect.fail(new SandboxRunError({ message: "membership hook failed" })),
		}),
	);
});
