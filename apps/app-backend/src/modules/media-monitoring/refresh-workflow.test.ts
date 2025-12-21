import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import {
	MediaMonitoringRefreshWorkflow,
	type MediaMonitoringRefreshPayload,
	runMediaMonitoringRefreshWorkflow,
} from "./refresh-workflow";

const payload = {
	entitySchemaSlug: "movie",
	externalId: "provider-movie",
	executionId: "media-monitoring-run",
	entityId: EntityId.make("media-monitoring-entity"),
	entitySchemaId: EntitySchemaId.make("schema-movie"),
	sandboxScriptId: SandboxScriptId.make("provider-script"),
} satisfies MediaMonitoringRefreshPayload;

type ExecuteStub = (
	...args: Parameters<WorkflowEngine["Type"]["execute"]>
) => Effect.Effect<unknown, unknown>;

const runWithEngine = <A, E, R>(execute: ExecuteStub, effect: Effect.Effect<A, E, R>) => {
	const instance = WorkflowInstance.initial(MediaMonitoringRefreshWorkflow, payload.executionId);
	const engine = makeWorkflowActivityEngine(instance, { execute });
	return effect.pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, engine),
	);
};

it.effect("refreshes monitored media through the provider population owner", () => {
	const calls: Array<Parameters<WorkflowEngine["Type"]["execute"]>[1]> = [];

	return runWithEngine(
		(_workflow, options) =>
			Effect.sync(() => {
				calls.push(options);
				return options.executionId;
			}),
		Effect.gen(function* () {
			yield* runMediaMonitoringRefreshWorkflow(payload);
			expect(calls).toEqual([
				{
					executionId: `${payload.executionId}-provider-refresh`,
					payload: {
						userId: null,
						mode: "refresh",
						externalId: payload.externalId,
						scriptId: payload.sandboxScriptId,
						origin: { kind: "provider_refresh" },
						entitySchemaId: payload.entitySchemaId,
						entitySchemaSlug: payload.entitySchemaSlug,
						executionId: `${payload.executionId}-provider-refresh`,
					},
				},
			]);
		}),
	);
});

it.effect("propagates provider population failures", () =>
	runWithEngine(
		() => Effect.fail(new SandboxRunError({ message: "provider boom" })),
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runMediaMonitoringRefreshWorkflow(payload));
			expect(exit._tag).toBe("Failure");
		}),
	),
);
