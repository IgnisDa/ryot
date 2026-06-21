import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-support/effect";

import { monitoringInfrequentTask } from "./infrequent-task";
import { MonitoringRepository, type MonitoringTarget } from "./repository";

const targets = [
	{
		externalId: "movie-a",
		entitySchemaSlug: "movie",
		entityId: EntityId.make("entity-a"),
		entitySchemaId: EntitySchemaId.make("schema-movie"),
		sandboxScriptId: SandboxScriptId.make("script-a"),
	},
	{
		externalId: "person-b",
		entitySchemaSlug: "person",
		entityId: EntityId.make("entity-b"),
		sandboxScriptId: SandboxScriptId.make("script-b"),
		entitySchemaId: EntitySchemaId.make("schema-person"),
	},
] satisfies ReadonlyArray<MonitoringTarget>;

const monitoringRepositoryMock = Layer.mock(MonitoringRepository);

const makeMonitoringRepository = (overrides: MockOverrides<typeof monitoringRepositoryMock> = {}) =>
	monitoringRepositoryMock({
		listTargets: () => Effect.succeed([]),
		...overrides,
		_tag: "MonitoringRepository",
	});

it.effect("fans out stable monitoring workflow ids and continues after an enqueue failure", () => {
	const captured: Array<Parameters<WorkflowEngine["Type"]["execute"]>[1]> = [];
	const engine = makeWorkflowEngine({
		execute: (_workflow, options) =>
			Effect.sync(() => {
				captured.push(options);
				return options;
			}).pipe(
				Effect.flatMap((capturedOptions) =>
					capturedOptions.payload.executionId === "cron-run-entity-a"
						? Effect.fail(new Error("first enqueue failed"))
						: Effect.succeed(capturedOptions.executionId),
				),
			),
	});

	return Effect.gen(function* () {
		yield* monitoringInfrequentTask.run({ executionId: "cron-run" });

		expect(captured).toMatchObject([
			{
				discard: true,
				payload: {
					entityId: "entity-a",
					externalId: "movie-a",
					entitySchemaSlug: "movie",
					sandboxScriptId: "script-a",
					entitySchemaId: "schema-movie",
					executionId: "cron-run-entity-a",
				},
			},
			{
				discard: true,
				payload: {
					entityId: "entity-b",
					externalId: "person-b",
					entitySchemaSlug: "person",
					sandboxScriptId: "script-b",
					entitySchemaId: "schema-person",
					executionId: "cron-run-entity-b",
				},
			},
		]);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				Layer.succeed(WorkflowEngine, engine),
				makeMonitoringRepository({ listTargets: () => Effect.succeed([...targets]) }),
			),
		),
	);
});
