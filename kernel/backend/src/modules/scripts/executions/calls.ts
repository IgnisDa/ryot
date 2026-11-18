import { SandboxRunError, TimeoutError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { isAdmissionQueueFull } from "@ryot-app/sandbox/host/admission";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import { SidecarRecoverySuspended } from "@ryot-app/sandbox/host/supervisor";
import { Context, Duration, Effect, Layer, Option, Ref, Schedule, type Scope } from "effect";

import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { sandboxStartedAt } from "#modules/scripts/host/execution-context";

import { ExecutableArtifacts } from "../registry/executable-artifacts";
import {
	sandboxExecutionFailure,
	type SandboxExecutionResult,
	stampSandboxExecutionError,
} from "./result";
import { infrastructureRunError } from "./run-error";

const ADMISSION_RETRY = Schedule.spaced(Duration.millis(100)).pipe(Schedule.jittered);

const toRunError = (error: unknown) => {
	if (error instanceof SandboxRunError) {
		return error;
	}
	if (error instanceof TimeoutError) {
		return new SandboxRunError({ kind: "timeout", message: error.message });
	}
	if (error instanceof SidecarRecoverySuspended) {
		return new SandboxRunError({
			kind: "resource-unavailable",
			message: "Sandbox instance recovery is suspended",
		});
	}
	return infrastructureRunError(error);
};

export type ScriptCall = {
	readonly input: unknown;
	readonly lane: ExecutionLane;
	readonly executionId: string;
	readonly principal: ScriptExecutionPrincipal;
};

type Run = (call: ScriptCall) => Effect.Effect<SandboxExecutionResult>;

const unavailable = sandboxExecutionFailure(
	new SandboxRunError({ kind: "resource-unavailable", message: "The sandbox is not running" }),
);

/**
 * Runs a pinned script once on the plain host, with no workflow, journal, or durable host. A run
 * holds one sandbox lease and releases it before returning, so no caller holds a lease while
 * another script waits for one. Host calls run in the caller's database transaction.
 *
 * Migrations and the runtime share one layer graph, so the runtime installs the sandbox once it
 * exists; until then every run fails as `resource-unavailable`.
 */
export class ScriptCalls extends Context.Service<
	ScriptCalls,
	{ readonly run: Run; readonly install: (run: Run) => Effect.Effect<void, never, Scope.Scope> }
>()("@ryot-app/kernel-backend/modules/scripts/executions/calls/ScriptCalls") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const installed = yield* Ref.make(Option.none<Run>());
			return {
				install: (run: Run) =>
					Effect.acquireRelease(Ref.set(installed, Option.some(run)), () =>
						Ref.set(installed, Option.none()),
					),
				run: (call: ScriptCall) =>
					Effect.flatMap(Ref.get(installed), (run) =>
						Option.isNone(run) ? Effect.succeed(unavailable) : run.value(call),
					),
			};
		}),
	);
}

export const ScriptCallsInstalledLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const artifacts = yield* ExecutableArtifacts;
		const sandbox = yield* SandboxExecutor;
		yield* (yield* ScriptCalls).install(
			Effect.fn("ScriptCalls.run")(function* (call: ScriptCall) {
				const startedAt = yield* sandboxStartedAt;
				return yield* Effect.gen(function* () {
					const artifact = yield* artifacts.get(call.principal);
					const result = yield* sandbox.run({
						startedAt,
						lane: call.lane,
						context: call.input,
						principal: call.principal,
						executionId: call.executionId,
						compiledCode: artifact.compiledCode,
						compiledFormat: artifact.compiledFormat,
					});
					if (result.recovery !== undefined) {
						yield* sandbox.completeRecovery(result.recovery);
					}
					return {
						logs: result.logs,
						value: result.value,
						timing: result.timing,
						status: "completed" as const,
						error:
							result.error === null
								? null
								: stampSandboxExecutionError(call.principal, result.error),
					};
				}).pipe(
					Effect.retry({ schedule: ADMISSION_RETRY, while: isAdmissionQueueFull }),
					Effect.catch((error) => Effect.succeed(sandboxExecutionFailure(toRunError(error)))),
				);
			}),
		);
	}),
).pipe(Layer.provideMerge(ScriptCalls.layer));
