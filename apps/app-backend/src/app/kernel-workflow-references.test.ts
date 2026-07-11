import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
	KernelWorkflowReferences,
} from "#modules/sandbox/kernel-workflow-references";

import { KernelWorkflowReferencesLive } from "./kernel-workflow-references";

const mockImportsRepository = Layer.mock(ImportsRepository);
const mockIntegrationsRepository = Layer.mock(IntegrationsRepository);

const unownedRepositories = Layer.mergeAll(
	mockImportsRepository({ _tag: "ImportsRepository", getRunById: () => Effect.succeed(null) }),
	mockIntegrationsRepository({
		_tag: "IntegrationsRepository",
		getForUser: () => Effect.succeed(null),
	}),
);

const referencesLayer = (repositories: Layer.Layer<ImportsRepository | IntegrationsRepository>) =>
	Layer.provide(KernelWorkflowReferencesLive, Layer.mergeAll(dbRunnerLayer, repositories));

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
		Effect.provide(referencesLayer(unownedRepositories)),
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
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);

it.effect("rejects a script-supplied import run owned by another user", () =>
	Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
				{
					externalId: "book-1",
					entitySchemaSlug: "book",
					providerId: "openlibrary",
					origin: { kind: "import", importRunId: ImportRunId.make("victim-run") },
				},
				{ type: "user", userId: UserId.make("trusted-user") },
				"entity-import-execution",
			),
		);

		expect(exit.toString()).toContain(
			"import run 'victim-run' does not belong to the executing user",
		);
	}).pipe(
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);

it.effect("rejects a script-supplied integration owned by another user", () =>
	Effect.gen(function* () {
		const references = yield* KernelWorkflowReferences;
		const exit = yield* Effect.exit(
			references.execute(
				KERNEL_EVENT_CREATE_WORKFLOW,
				{
					payload: [],
					origin: "integration",
					integrationId: IntegrationId.make("victim-integration"),
				},
				{ type: "user", userId: UserId.make("trusted-user") },
				"event-create-execution",
			),
		);

		expect(exit.toString()).toContain(
			"integration 'victim-integration' does not belong to the executing user",
		);
	}).pipe(
		Effect.provide(referencesLayer(unownedRepositories)),
		Effect.provideService(WorkflowEngine, makeWorkflowEngine()),
	),
);
