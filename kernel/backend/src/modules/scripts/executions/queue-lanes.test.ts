import { layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { stubRuntimeSandboxExecutor } from "@ryot-app/sandbox/host/executor.test-support";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Deferred, Effect, Layer, Schedule, Schema } from "effect";
import { PersistedQueue } from "effect/persistence";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";
import { expect, it } from "vitest";

import { RedisService } from "#platform/redis";
import { fairQueueKeys, fairQueueStoreLayer } from "#platform/workflow/fair-queue-store";
import { implementWorkflow } from "#platform/workflow/scope";
import { makeAppConfigLayer, workflowEngineTestLayer } from "#testing/effect";
import { testRedisServiceLayer } from "#testing/redis";

import { SandboxDurableHostDispatcher } from "../host/durable-dispatcher";
import {
	compiledArtifactsLayer,
	scriptRepositoryLayer,
	unusedKernelWorkflowReferencesLayer,
} from "./fixtures.test-support";
import {
	processSandboxExecutionQueue,
	SandboxExecutionQueueWorkerLive,
	sandboxLaneCapacity,
} from "./queues";
import { sandboxSchedulingKey } from "./scheduling-key";

const BACKGROUND_BACKLOG = 100;
const prefix = `ryot:test:lanes:${crypto.randomUUID()}:`;
const queueKeys = fairQueueKeys(prefix, "DurableQueue/SandboxExecutionQueue");
const scriptId = SandboxScriptId.make("lane-script");
const scriptCode = "lane";
const scriptContentHash = sha256Hex(scriptCode);

class LaneControl extends Context.Service<
	LaneControl,
	{
		readonly gate: Deferred.Deferred<void>;
		readonly starts: Array<{ readonly lane: ExecutionLane; readonly executionId: string }>;
	}
>()("test/LaneControl") {}

const LaneWorkflow = Workflow.make("DurableQueueLaneWorkflow", {
	success: Schema.Void,
	error: SandboxRunError,
	idempotencyKey: ({ executionId }) => executionId,
	payload: { lane: ExecutionLane, executionId: Schema.String },
});

const queueWorkflowLive = implementWorkflow(LaneWorkflow, ({ lane, executionId }) =>
	processSandboxExecutionQueue({
		lane,
		context: {},
		executionId,
		journalLength: 0,
		workflowExecutionId: executionId,
		startedAt: "2026-01-01T00:00:00.000Z",
		principal: {
			scriptId,
			providerId: null,
			scriptSlug: "lane",
			pluginRevision: null,
			subject: { type: "system" },
			contentHash: scriptContentHash,
			metadata: { runtimeImports: [] },
		},
	}).pipe(Effect.asVoid, Effect.orDie),
);

const controlLayer = Layer.effect(
	LaneControl,
	Effect.map(Deferred.make<void>(), (gate) => ({ gate, starts: [] })),
);

const recoveryPinHash = sha256Hex("durable-queue-lane-test-recovery-pin");

const runtimeLayer = Layer.effect(
	SandboxExecutor,
	Effect.gen(function* () {
		const { gate, starts } = yield* LaneControl;
		return stubRuntimeSandboxExecutor((input) =>
			Effect.sync(() => starts.push({ lane: input.lane, executionId: input.executionId })).pipe(
				Effect.andThen(input.lane === "background" ? Deferred.await(gate) : Effect.void),
				Effect.as({
					logs: [],
					inline: [],
					error: null,
					success: true,
					harvest: null,
					value: "done",
					pendingInline: [],
					executionId: input.executionId,
					timing: { totalMs: 1, executionMs: 1 },
					recovery: {
						instance: "system/core",
						pinHash: recoveryPinHash,
						executionId: input.executionId,
					},
				}),
			),
		);
	}),
);

const repositoryLayer = scriptRepositoryLayer((id) => ({
	id,
	providerId: null,
	compiledFormat: 1,
	compiledCode: scriptCode,
	contentHash: scriptContentHash,
	metadata: { runtimeImports: [] },
}));
const artifactLayer = compiledArtifactsLayer(repositoryLayer);

const queueLayer = Layer.mergeAll(
	queueWorkflowLive,
	artifactLayer,
	Layer.succeed(SandboxDurableHostDispatcher, {
		cancelInline: () => Effect.void,
		dispatch: () => Effect.die("durable dispatch is not expected"),
		settleInline: () => Effect.die("inline dispatch is not expected"),
	}),
	unusedKernelWorkflowReferencesLayer,
).pipe(
	Layer.provideMerge(
		PersistedQueue.layer.pipe(
			Layer.provide(
				fairQueueStoreLayer({
					prefix,
					pollInterval: "10 millis",
					flowOf: sandboxSchedulingKey,
					capacity: sandboxLaneCapacity(2),
				}),
			),
		),
	),
	Layer.provideMerge(workflowEngineTestLayer),
	Layer.provideMerge(runtimeLayer),
	Layer.provideMerge(controlLayer),
	Layer.provideMerge(makeAppConfigLayer({ sandbox: { workerConcurrency: 2 } })),
	Layer.provideMerge(testRedisServiceLayer),
);

const eventually = <E, R>(check: Effect.Effect<boolean, E, R>) =>
	check.pipe(
		Effect.repeat({ until: (done) => done, schedule: Schedule.spaced(10) }),
		Effect.timeout("10 seconds"),
	);

layer(queueLayer, { excludeTestServices: true })((test) => {
	test.effect("durable_execution_backlog_does_not_capture_interactive_workers", () =>
		Effect.gen(function* () {
			const { client } = yield* RedisService;
			yield* Effect.addFinalizer(() =>
				Effect.tryPromise(() => client.keys(`${prefix}*`)).pipe(
					Effect.flatMap((keys) =>
						keys.length === 0 ? Effect.void : Effect.tryPromise(() => client.del(...keys)),
					),
					Effect.orDie,
				),
			);
			const engine = yield* WorkflowEngine;
			const control = yield* LaneControl;

			yield* Effect.forEach(
				Array.from({ length: BACKGROUND_BACKLOG }, (_, index) => `background-${index}`),
				(executionId) =>
					engine.execute(LaneWorkflow, {
						executionId,
						discard: true,
						payload: { executionId, lane: "background" },
					}),
				{ discard: true, concurrency: "unbounded" },
			);
			yield* eventually(
				Effect.map(
					Effect.tryPromise(() => client.hlen(queueKeys.items)),
					(queued) => queued === BACKGROUND_BACKLOG,
				),
			);

			yield* Layer.build(SandboxExecutionQueueWorkerLive);
			yield* eventually(Effect.sync(() => control.starts.length === 1));
			yield* Effect.sleep(300);
			expect(control.starts.map((start) => start.lane)).toEqual(["background"]);
			expect(yield* Effect.tryPromise(() => client.scard(queueKeys.pending))).toBe(1);

			yield* engine.execute(LaneWorkflow, {
				executionId: "interactive-0",
				payload: { lane: "interactive", executionId: "interactive-0" },
			});
			expect(control.starts.map((start) => start.lane)).toEqual(["background", "interactive"]);
			expect(yield* Deferred.isDone(control.gate)).toBe(false);
		}),
	);
});

it("reserves half the workers for background work, at least one", () => {
	expect(sandboxLaneCapacity(4)).toEqual({ total: 4, background: 2 });
	expect(sandboxLaneCapacity(1)).toEqual({ total: 1, background: 1 });
});
