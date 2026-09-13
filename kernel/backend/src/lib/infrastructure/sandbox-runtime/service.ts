import { SandboxRunError, TimeoutError, unknownToMessage } from "@ryot-app/contract/errors";
import { jsonByteLength, utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { SANDBOX_COMPILED_FORMAT } from "@ryot-app/sandbox-compiler/protocol";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Cause, Clock, Context, Effect, Layer, Option, Schema } from "effect";

import {
	sandboxDurableHostDispatchStrategy,
	sandboxHostResultBytes,
} from "#modules/sandbox/durable-host-dispatcher";

import {
	recordSandboxExecution,
	sandboxMetricKind,
	type SandboxExecutionOutcome,
} from "../runtime-metrics";
import type { SandboxRecoveryIdentity } from "../sandbox-recovery-store";
import { bindSandboxHostFunctions } from "./bridge-adapter";
import { isSandboxCapability } from "./capability-policy";
import type { SandboxExecutionPrincipal } from "./execution-principal";
import { SandboxFileService } from "./file-service";
import { isSandboxFilesystemGrantCapability } from "./filesystem-grants";
import { SandboxHostCallGate } from "./host-call-gate";
import { SandboxHostImplementations } from "./host-implementations";
import { sandboxContextError, SANDBOX_LIMITS, SANDBOX_RUNNER_LIMITS } from "./limits";
import {
	makeObservabilitySandboxApiFunctions,
	makeSandboxObservabilityCollector,
	mergeSandboxExecutionLogs,
} from "./observability-host-functions";
import {
	isSandboxCapabilityAllowed,
	sandboxMetadataKind,
	sandboxPlatformFailureKind,
	type BoundHostFunction,
	type SandboxRunInput,
} from "./shared";
import { SandboxAdmissionLease } from "./sidecar-admission";
import {
	SandboxInvocationResponseSchema,
	SandboxInvocationSchema,
	type SidecarDoneFrame,
} from "./sidecar-protocol";
import {
	SandboxSidecarSupervisor,
	SidecarGenerationError,
	SidecarRecoverySuspended,
} from "./sidecar-supervisor";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));
const decodeResponse = Schema.decodeUnknownEffect(SandboxInvocationResponseSchema, {
	onExcessProperty: "error",
});

// Workflow-dispatched capabilities may wait for nested sandbox runs, and unbounded results cannot be
// charged to transient memory, so live executions never bind them while holding a slot and memory.
const resourceFreeStrategies = new Set<ReturnType<typeof sandboxDurableHostDispatchStrategy>>([
	"activity",
	"diagnostic",
]);

export const selectSandboxHostFunctions = (
	boundApiFunctions: Readonly<Record<string, BoundHostFunction>>,
	input: Pick<SandboxRunInput, "principal" | "workflowExecutionId">,
) => {
	const selected: Record<string, BoundHostFunction> = {};
	const workflow =
		input.workflowExecutionId !== undefined ||
		sandboxMetadataKind(input.principal.metadata) === "workflow";
	for (const name of input.principal.metadata.capabilities ?? []) {
		if (
			!isSandboxCapability(name) ||
			isSandboxFilesystemGrantCapability(name) ||
			(workflow && name !== "log" && name !== "span") ||
			!resourceFreeStrategies.has(sandboxDurableHostDispatchStrategy(name)) ||
			sandboxHostResultBytes(name) === null ||
			!isSandboxCapabilityAllowed(input, name)
		) {
			continue;
		}
		const fn = boundApiFunctions[name];
		if (fn !== undefined) {
			selected[name] = fn;
		}
	}
	return selected;
};

export class SandboxService extends Context.Service<SandboxService>()("SandboxService", {
	make: Effect.gen(function* () {
		const supervisor = yield* SandboxSidecarSupervisor;
		const gate = yield* SandboxHostCallGate;
		const files = yield* SandboxFileService;
		const hosts = yield* SandboxHostImplementations;
		const apiFunctions = { ...hosts.runtime, ...hosts.additional, ...hosts.automation };
		const reserve = Effect.fn("SandboxService.reserve")(function* (
			principal: SandboxExecutionPrincipal,
			journalBytes: number,
		) {
			return yield* supervisor.reserve(principal, journalBytes);
		});
		const run = Effect.fn("SandboxService.run")(function* (input: SandboxRunInput) {
			const executionStartedAt = yield* Clock.currentTimeMillis;
			const kind = sandboxMetricKind(input.principal.metadata);
			let terminal:
				| {
						readonly durationMs: number;
						readonly responseBytes: number;
						readonly outcome: SandboxExecutionOutcome;
				  }
				| undefined;
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const existingLease = yield* Effect.serviceOption(SandboxAdmissionLease);
					const lease = Option.isSome(existingLease)
						? existingLease.value
						: yield* reserve(
								input.principal,
								input.replayJournal === undefined ? 2 : SANDBOX_LIMITS.journalBytes,
							);
					const context = input.context ?? {};
					const contextError = sandboxContextError(context);
					if (contextError !== null) {
						return yield* new SandboxRunError({ kind: "invalid-input", message: contextError });
					}
					if (
						input.compiledFormat !== SANDBOX_COMPILED_FORMAT ||
						utf8ByteLength(input.compiledCode) > SANDBOX_LIMITS.compiler.javascriptBytes ||
						sha256Hex(input.compiledCode) !== input.principal.contentHash
					) {
						return yield* new SandboxRunError({
							kind: "missing-artifact",
							message: "Sandbox compiled module does not match its pinned artifact",
						});
					}
					const journalBytes = jsonByteLength(input.replayJournal ?? []);
					if (journalBytes === null) {
						return yield* new SandboxRunError({
							kind: "invalid-input",
							message: "Sandbox journal is not JSON",
						});
					}
					yield* lease.retainJournal(journalBytes);
					const parentSpan = yield* Effect.currentSpan;
					const collector = makeSandboxObservabilityCollector();
					const selected = selectSandboxHostFunctions(
						bindSandboxHostFunctions(
							{ ...apiFunctions, ...makeObservabilitySandboxApiFunctions(collector) },
							input,
						),
						input,
					);
					const result = yield* supervisor.run({
						lease,
						principal: input.principal,
						executionId: input.executionId,
						pinHash: sha256Hex(
							stableStringify({
								context,
								principal: input.principal,
								startedAt: input.startedAt,
								journal: input.replayJournal,
								workflowExecutionId: input.workflowExecutionId,
							}),
						),
						prepare: (identity) =>
							Effect.gen(function* () {
								const access = yield* files.open(input);
								const registration = yield* gate
									.register({
										...identity,
										input,
										parentSpan,
										files: access,
										apiFunctions: selected,
									})
									.pipe(
										Effect.mapError(
											() =>
												new SandboxRunError({
													kind: "invalid-input",
													message: "Sandbox host registration is invalid",
												}),
										),
									);
								const invocation = yield* Schema.decodeUnknownEffect(SandboxInvocationSchema, {
									onExcessProperty: "error",
								})({
									context,
									mode: "definition",
									executionId: input.executionId,
									metadata: input.principal.metadata,
									scriptId: input.principal.scriptId,
									apiFunctions: Object.keys(selected),
									compiledFormat: SANDBOX_COMPILED_FORMAT,
									startedAt: input.startedAt ?? "1970-01-01T00:00:00.000Z",
									...(registration.journal === undefined ? {} : { journal: registration.journal }),
									...(input.workflowExecutionId === undefined
										? {}
										: { workflowExecutionId: input.workflowExecutionId }),
									...(input.inlineDurableHost === undefined
										? {}
										: { inlineDurableCapabilities: input.inlineDurableHost.capabilities }),
									filesystem: access.filesystem,
								}).pipe(
									Effect.mapError(
										() =>
											new SandboxRunError({
												kind: "invalid-input",
												message: "Sandbox invocation is invalid",
											}),
									),
								);
								const json = yield* Schema.decodeUnknownEffect(Schema.Json)(invocation).pipe(
									Effect.mapError(
										() =>
											new SandboxRunError({
												kind: "invalid-input",
												message: "Sandbox invocation is not JSON",
											}),
									),
								);
								if (utf8ByteLength(encodeJson(json)) > SANDBOX_LIMITS.execution.requestBytes) {
									return yield* new SandboxRunError({
										kind: "invalid-input",
										message: "Sandbox invocation exceeds its byte limit",
									});
								}
								return {
									input: json,
									gate: registration,
									module: { source: input.compiledCode, sha256: input.principal.contentHash },
									finish: Effect.fnUntraced(function* (done: typeof SidecarDoneFrame.Type) {
										const outcome = done.outcome;
										if (
											outcome.status === "cancelled" ||
											(outcome.status === "limit" &&
												(outcome.limit === "cpu" || outcome.limit === "deadline"))
										) {
											return yield* new TimeoutError({
												message: "Sandbox execution exceeded its time budget",
											});
										}
										if (outcome.status !== "completed") {
											return yield* new SandboxRunError({
												kind: "script-failure",
												message: outcome.message,
											});
										}
										const response = yield* decodeResponse(outcome.value).pipe(
											Effect.mapError(
												() =>
													new SandboxRunError({
														kind: "infrastructure",
														message: "Sandbox sidecar returned an invalid invocation response",
													}),
											),
										);
										if (!response.success) {
											return { response, harvest: null };
										}
										const completed =
											isObjectRecord(response.value) && response.value["state"] === "completed"
												? response.value["output"]
												: response.value;
										return { response, harvest: yield* access.harvest(completed) };
									}),
								};
							}),
					});
					const { harvest, response } = result.finished;
					const totalMs = Math.max(1, (yield* Clock.currentTimeMillis) - executionStartedAt);
					terminal = {
						durationMs: totalMs,
						responseBytes: jsonByteLength(response) ?? 0,
						outcome: response.success ? "success" : "failure",
					};
					const consoleLogs = [
						...response.logs,
						...result.done.console.entries.map((entry) => entry.message),
					];
					if (result.done.console.truncated) {
						consoleLogs.push(SANDBOX_RUNNER_LIMITS.logTruncationMarker);
					}
					return {
						harvest,
						inline: result.inline,
						recovery: result.recovery,
						success: response.success,
						executionId: input.executionId,
						value: response.success ? response.value : null,
						error: response.success ? null : response.error,
						logs: mergeSandboxExecutionLogs(consoleLogs, collector),
						timing: { totalMs, executionMs: response.timing.executionMs },
					};
				}),
			).pipe(
				Effect.mapError((error) =>
					error instanceof TimeoutError ||
					error instanceof SandboxRunError ||
					error instanceof SidecarGenerationError ||
					error instanceof SidecarRecoverySuspended
						? error
						: new SandboxRunError({
								message: unknownToMessage(error),
								kind: sandboxPlatformFailureKind(error),
							}),
				),
				Effect.onExit((exit) =>
					Effect.gen(function* () {
						if (terminal !== undefined) {
							yield* recordSandboxExecution({ kind, ...terminal });
							return undefined;
						}
						const error =
							exit._tag === "Failure" ? Cause.findErrorOption(exit.cause) : Option.none();
						yield* recordSandboxExecution({
							kind,
							responseBytes: 0,
							durationMs: Math.max(1, (yield* Clock.currentTimeMillis) - executionStartedAt),
							outcome:
								Option.isSome(error) && error.value instanceof TimeoutError ? "timeout" : "failure",
						});
						return undefined;
					}),
				),
			);
		}, Effect.withSpan("sandbox.execution"));
		const completeRecovery = Effect.fn("SandboxService.completeRecovery")(function* (
			identity: SandboxRecoveryIdentity,
		) {
			yield* supervisor.completeRecovery(identity);
		});
		return { run, reserve, completeRecovery };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provideMerge(SandboxSidecarSupervisor.layer),
		Layer.provide(SandboxHostCallGate.layer),
		Layer.provide(SandboxFileService.layer),
	);
}
