import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import { EntityImportWorkflow, runEntityImportWorkflow } from "./entity-import-workflow";

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
				userId: UserId.make("user-1"),
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
		]);
	}).pipe(
		Effect.provideService(
			WorkflowEngine,
			makeWorkflowActivityEngine(instance, {
				execute: (workflow, options) =>
					Effect.sync(() => {
						calls.push({ name: workflow.name, options });
						return entity;
					}),
			}),
		),
		Effect.provideService(WorkflowInstance, instance),
	);
};

it.effect("imports an unrelated provider entity without domain membership work", () =>
	importWithoutMembership("unrelated-fixture"),
);

it.effect("imports a fitness entity without media membership work", () =>
	importWithoutMembership("workout"),
);
