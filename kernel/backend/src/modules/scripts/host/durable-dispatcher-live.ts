import { SandboxRunError } from "@ryot-app/contract/errors";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import {
	type WorkflowDurableResult,
	workflowDurableResultSchema,
} from "@ryot-app/plugin-backend-sdk/workflow/protocol";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { sandboxDurableHostDispatchStrategy } from "@ryot-app/sandbox/host/host-execution-policy";
import { recordSandboxHostCall } from "@ryot-app/sandbox/host/metrics";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { Effect, Layer, Schema } from "effect";

import {
	dispatchSandboxHostActivity,
	hostCallScopeOf,
	SandboxDurableHostDispatcher,
} from "#modules/scripts/host/durable-dispatcher";
import { ScriptHostImplementations } from "#modules/scripts/host/host-implementations";
import { SandboxHttpDispatcher } from "#modules/scripts/host/http-dispatcher";
import { makeActivity } from "#platform/workflow/scope";

type DispatchArguments = Parameters<SandboxDurableHostDispatcher["Service"]["dispatch"]>;

const recordHostCall = <A extends null | WorkflowDurableResult, E, R>(
	request: DispatchArguments[0],
	effect: Effect.Effect<A, E, R>,
) =>
	effect.pipe(
		Effect.onExit((exit) =>
			exit._tag === "Success" && exit.value === null
				? Effect.void
				: recordSandboxHostCall({
						function: request.args.capability,
						outcome:
							exit._tag === "Success" && exit.value?.state === "success" ? "success" : "failure",
					}),
		),
	);

const settlesInline = (
	request: Parameters<SandboxDurableHostDispatcher["Service"]["settleInline"]>[0][number],
) => {
	const strategy = sandboxDurableHostDispatchStrategy(request.args.capability);
	return strategy !== null && strategy !== "diagnostic";
};

export const SandboxDurableHostDispatcherLive = Layer.effect(
	SandboxDurableHostDispatcher,
	Effect.gen(function* () {
		const authority = yield* SandboxExecutionAuthority;
		const httpDispatcher = yield* SandboxHttpDispatcher;
		const implementations = yield* ScriptHostImplementations;

		const dispatchDurableHostCall: SandboxDurableHostDispatcher["Service"]["dispatch"] = (
			request,
			payload,
			principal,
			executionId,
			progress,
		) => {
			const { startedAt } = payload;
			const strategy = sandboxDurableHostDispatchStrategy(request.args.capability);
			if (strategy === null || strategy === "diagnostic") {
				return Effect.fail(
					new SandboxRunError({
						kind: "script-failure",
						message:
							strategy === null
								? `Sandbox durable host capability is not dispatchable: ${request.args.capability}`
								: `Sandbox diagnostic capability must not enter the durable journal: ${request.args.capability}`,
					}),
				);
			}
			const resolved = authority.resolve(principal);
			if (request.args.capability === "httpCall") {
				return Effect.andThen(
					resolved,
					httpDispatcher.dispatch(request, payload, principal, executionId, startedAt, progress),
				);
			}
			return Effect.andThen(
				resolved,
				makeActivity({
					error: SandboxRunError,
					success: workflowDurableResultSchema,
					name: `sandbox-host-${request.index}-${request.args.capability}`,
					execute: dispatchSandboxHostActivity(
						implementations,
						request,
						hostCallScopeOf(payload, principal, executionId, startedAt),
					),
				}),
			);
		};

		return {
			dispatch: (request, payload, principal, executionId, progress) =>
				recordHostCall(
					request,
					dispatchDurableHostCall(request, payload, principal, executionId, progress),
				),
			settleInline: (
				requests,
				context,
				principal,
				lane,
				executionId,
				startedAt,
				wait,
				checkpoint,
			) =>
				Effect.gen(function* () {
					if (!requests.every(settlesInline)) {
						return null;
					}
					const input = yield* Schema.decodeUnknownEffect(jsonValueSchema)(context).pipe(
						Effect.orDie,
					);
					const results = yield* Effect.forEach(
						requests,
						(
							request,
						): Effect.Effect<
							{ settled: boolean; value: null | WorkflowDurableResult },
							SandboxRunError
						> =>
							Effect.gen(function* () {
								const scope = { lane, context, principal, startedAt, executionId };
								const value = yield* recordHostCall(
									request,
									Effect.andThen(
										authority.resolve(principal),
										request.args.capability === "httpCall"
											? httpDispatcher.inline(
													request,
													{
														lane,
														input,
														executionId,
														resolutionMode: "exact",
														subject: principal.subject,
														scriptId: principal.scriptId,
													},
													principal,
													executionId,
													startedAt,
													wait,
													(progress) => checkpoint({ request, progress, _tag: "Http" }),
												)
											: dispatchSandboxHostActivity(implementations, request, scope),
									),
								);
								if (value === null) {
									return { value, settled: false };
								}
								const json = yield* Schema.decodeUnknownEffect(jsonValueSchema)(value).pipe(
									Effect.orDie,
								);
								yield* checkpoint({ request, value: json, _tag: "Completed" });
								return { value, settled: true };
							}),
						{ concurrency: SANDBOX_LIMITS.bridge.concurrentHostCalls },
					);
					return results.every((result) => result.settled)
						? results.map((result) => result.value)
						: null;
				}).pipe(Effect.orElseSucceed(() => null)),
		};
	}),
).pipe(Layer.provide(SandboxHttpDispatcher.layer));
