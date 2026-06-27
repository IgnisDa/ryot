import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine, type MockOverrides } from "#lib/test-support/effect";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";

import { mediaMonitoringInfrequentTask } from "./infrequent-task";
import { MediaMonitoringRepository, type MediaMonitoringTarget } from "./repository";

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
] satisfies ReadonlyArray<MediaMonitoringTarget>;

const mediaMonitoringRepositoryMock = Layer.mock(MediaMonitoringRepository);

const makeMediaMonitoringRepository = (
	overrides: MockOverrides<typeof mediaMonitoringRepositoryMock> = {},
) =>
	mediaMonitoringRepositoryMock({
		listTargets: () => Effect.succeed([]),
		...overrides,
		_tag: "MediaMonitoringRepository",
	});

it.effect(
	"fans out stable provider refresh workflow ids and continues after an enqueue failure",
	() => {
		const captured: Array<Parameters<WorkflowEngine["Type"]["execute"]>[1]> = [];
		const instance = WorkflowInstance.initial(InfrequentCronWorkflow, "cron-run");
		const engine = makeWorkflowEngine({
			execute: (_workflow, options) => {
				captured.push(options);
				return options.payload.executionId === "cron-run-entity-a-provider-refresh"
					? Effect.die("first enqueue failed")
					: Effect.succeed(options.executionId);
			},
		});

		return Effect.gen(function* () {
			yield* mediaMonitoringInfrequentTask.run({ executionId: "cron-run" });

			expect(captured).toMatchObject([
				{
					discard: true,
					payload: {
						userId: null,
						mode: "refresh",
						externalId: "movie-a",
						scriptId: "script-a",
						entitySchemaSlug: "movie",
						entitySchemaId: "schema-movie",
						origin: { kind: "provider_refresh" },
						executionId: "cron-run-entity-a-provider-refresh",
					},
				},
				{
					discard: true,
					payload: {
						userId: null,
						mode: "refresh",
						scriptId: "script-b",
						externalId: "person-b",
						entitySchemaSlug: "person",
						entitySchemaId: "schema-person",
						origin: { kind: "provider_refresh" },
						executionId: "cron-run-entity-b-provider-refresh",
					},
				},
			]);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					dbRunnerLayer,
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(WorkflowInstance, instance),
					makeMediaMonitoringRepository({ listTargets: () => Effect.succeed([...targets]) }),
				),
			),
		);
	},
);
