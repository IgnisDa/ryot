import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { makeWorkflowEngine } from "#lib/test-utils/effect";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
	KernelWorkflowReferences,
} from "#modules/sandbox/kernel-workflow-references";

import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";

it.effect("binds kernel workflow user ids to the trusted execution authority", () => {
	const payloads: unknown[] = [];
	const engine = makeWorkflowEngine({
		execute: (workflow, options) =>
			Effect.sync(() => {
				payloads.push(options.payload);
				return workflow.name === "EventCreateWorkflow" ? [] : { id: "entity-1" };
			}),
	});

	return Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const authority = { type: "user" as const, userId: UserId.make("trusted-user") };
		yield* references.execute(
			KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
			{
				externalId: "book-1",
				entitySchemaSlug: "book",
				providerId: "openlibrary",
				origin: { kind: "import" },
				userId: "attacker-selected-user",
			},
			authority,
			"entity-import-execution",
		);
		yield* references.execute(
			KERNEL_EVENT_CREATE_WORKFLOW,
			{ payload: [], origin: "import", userId: "attacker-selected-user" },
			authority,
			"event-create-execution",
		);

		expect(payloads).toMatchObject([
			{ userId: "trusted-user", executionId: "entity-import-execution" },
			{ userId: "trusted-user", executionId: "event-create-execution" },
		]);
	}).pipe(
		Effect.provide(KernelWorkflowReferencesLive),
		Effect.provideService(WorkflowEngine, engine),
	);
});

it.effect("rejects user-scoped kernel workflows for system executions", () =>
	Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
				{
					externalId: "book-1",
					entitySchemaSlug: "book",
					providerId: "openlibrary",
					origin: { kind: "import" },
					userId: "attacker-selected-user",
				},
				{ type: "system" },
				"entity-import-execution",
			),
		);

		expect(exit.toString()).toContain("is not available for system executions");
	}).pipe(
		Effect.provide(KernelWorkflowReferencesLive),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);
