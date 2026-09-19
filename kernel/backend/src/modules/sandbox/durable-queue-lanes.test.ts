import { layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Deferred, Effect, Layer, Schedule, Schema } from "effect";
import { PersistedQueue } from "effect/persistence";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";
import { expect } from "vitest";

import { fairQueueKeys, fairQueueStoreLayer } from "#lib/infrastructure/fair-queue-store";
import { RedisService } from "#lib/infrastructure/redis";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { makeAppConfigLayer, workflowEngineTestLayer } from "#lib/test-utils/effect";
import { testRedisServiceLayer } from "#lib/test-utils/redis";
import { stubRuntimeSandboxService } from "#lib/test-utils/sandbox-runtime";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import {
	processSandboxExecutionQueue,
	sandboxLaneCapacity,
	SandboxExecutionQueueWorkerLive,
} from "./durable-queues";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";
import { sandboxSchedulingKey } from "./scheduling-key";

const BACKGROUND_BACKLOG = 100;
const prefix = `ryot:test:lanes:${crypto.randomUUID()}:`;
const queueKeys = fairQueueKeys(prefix, "DurableQueue/SandboxExecutionQueue");
const scriptId = SandboxScriptId.make("lane-script");

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

const laneWorkflow = implementWorkflow(LaneWorkflow, ({ lane, executionId }) =>
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
			contentHash: "lane-hash",
			subject: { type: "system" },
			metadata: { runtimeImports: [] },
		},
	}).pipe(Effect.asVoid),
);

const controlLayer = Layer.effect(
	LaneControl,
	Effect.map(Deferred.make<void>(), (gate) => ({ gate, starts: [] })),
);

const recoveryPinHash = sha256Hex("durable-queue-lane-test-recovery-pin");

const runtimeLayer = Layer.effect(
	RuntimeSandboxService,
	Effect.gen(function* () {
		const { gate, starts } = yield* LaneControl;
		return stubRuntimeSandboxService((input) =>
			Effect.sync(() => starts.push({ lane: input.lane, executionId: input.executionId })).pipe(
				Effect.andThen(input.lane === "background" ? Deferred.await(gate) : Effect.void),
				Effect.as({
					logs: [],
					inline: [],
					error: null,
					success: true,
					harvest: null,
					value: "done",
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

const queueLayer = Layer.mergeAll(
	laneWorkflow,
	Layer.succeed(SandboxDurableHostDispatcher, {
		dispatch: () => Effect.die("durable dispatch is not expected"),
		settleInline: () => Effect.die("inline dispatch is not expected"),
	}),
	Layer.succeed(KernelWorkflowReferences, {
		execute: () => Effect.die("kernel dispatch is not expected"),
		resolveArtifactGrants: (_input, _subject, grants) => Effect.succeed(grants),
	}),
	Layer.mock(SandboxRepository)({
		getScript: (id) =>
			Effect.succeed({
				id,
				providerId: null,
				compiledFormat: 1,
				compiledCode: "lane",
				contentHash: "lane-hash",
				metadata: { runtimeImports: [] },
			}),
	}),
).pipe(
	Layer.provideMerge(
		PersistedQueue.layer.pipe(
			Layer.provide(
				fairQueueStoreLayer({
					prefix,
					pollInterval: "10 millis",
					flowOf: sandboxSchedulingKey,
					capacity: sandboxLaneCapacity(2),
					lanes: ["interactive", "background"],
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
