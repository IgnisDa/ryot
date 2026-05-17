import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	ExecutionAuthority,
	SandboxExecutionGrants,
	type SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import {
	type WorkflowDurableResult,
	type WorkflowReplayEnvelope,
	workflowDurableCallRequestSchema,
	workflowReplayEnvelopeSchema,
	type WorkflowDurableCallRequest,
} from "@ryot/sandbox-sdk/workflow";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Cause, Clock, DateTime, Duration, Effect, Schema } from "effect";
import { Activity, DurableClock, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { sanitizeSandboxExecutionSegment } from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import {
	jsonByteLength,
	SANDBOX_LIMITS,
	WORKFLOW_SANDBOX_LIMITS,
} from "#lib/infrastructure/sandbox-runtime/limits";
import {
	hashWorkflowCallArgs,
	projectWorkflowJournal,
	type WorkflowJournalEntry,
} from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { type DurableSchema, withoutWorkflowParent } from "#lib/infrastructure/workflow";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { processSandboxExecutionQueue, resolveSandboxExecutionPayload } from "./durable-queues";
import type { SandboxExecutionResult } from "./execution-result";
import {
	KernelWorkflowReferences,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
} from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

export const SANDBOX_WORKFLOW_MAX_STEPS = 1_000;
const SANDBOX_WORKFLOW_MAX_PROJECTION_RETRIES = 3;

const SandboxWorkflowPin = Schema.Struct({
	startedAt: Schema.String,
	scriptId: SandboxScriptId,
	contentHash: Schema.String,
	pluginSlug: Schema.NullOr(Schema.String),
});

const ObservedWorkflowReplay = Schema.Union([
	Schema.Struct({ state: Schema.Literal("projection-stale") }),
	Schema.Struct({ error: Schema.String, state: Schema.Literal("failed") }),
	Schema.Struct({ output: jsonValueSchema, state: Schema.Literal("completed") }),
	Schema.Struct({
		state: Schema.Literal("pending"),
		requests: Schema.Array(
			Schema.Struct({
				request: workflowDurableCallRequestSchema,
				targetScriptId: Schema.optional(SandboxScriptId),
			}),
		),
	}),
]);
type ObservedWorkflowReplay = Schema.Schema.Type<typeof ObservedWorkflowReplay>;

export const SandboxScriptWorkflowPayload = Schema.Struct({
	input: jsonValueSchema,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	authority: ExecutionAuthority,
	startedAt: Schema.optional(Schema.String),
	grants: Schema.optional(SandboxExecutionGrants),
	resolutionMode: Schema.Literals(["active", "exact"]),
});

export type SandboxScriptWorkflowPayload = Schema.Schema.Type<typeof SandboxScriptWorkflowPayload>;

export const SandboxScriptWorkflow = Workflow.make("SandboxScriptWorkflow", {
	error: SandboxRunError satisfies DurableSchema,
	success: jsonValueSchema satisfies DurableSchema,
	payload: SandboxScriptWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
});

const sandboxFailure = (message: string) => new SandboxRunError({ message });

export const establishSandboxWorkflowPin = Effect.fn("establishSandboxWorkflowPin")(function* (
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	expectedPluginSlug?: string,
) {
	const runWithDb = yield* DbRunner;
	const repository = yield* SandboxRepository;
	const runInTransaction = yield* TransactionRunner;
	const references = yield* SandboxWorkflowReferenceRepository;
	return yield* runInTransaction(
		Effect.gen(function* () {
			yield* references.lockIngestionShared();
			const resolved = yield* resolveSandboxExecutionPayload(
				{
					context: payload.input,
					scriptId: payload.scriptId,
					authority: payload.authority,
					executionId: payload.executionId,
					...(payload.grants ? { grants: payload.grants } : {}),
				},
				payload.resolutionMode,
			);
			const pinned = yield* runWithDb(repository.getScriptPin(resolved.scriptId));
			if (!pinned) {
				return yield* sandboxFailure("Sandbox workflow script not found");
			}
			if (expectedPluginSlug && pinned.pluginSlug !== expectedPluginSlug) {
				return yield* sandboxFailure(
					`Sandbox workflow script is not owned by plugin '${expectedPluginSlug}'`,
				);
			}
			const registrationStatus = pinned.pluginSlug
				? (yield* references.registerInTransaction({
						executionId,
						scriptId: pinned.scriptId,
						pluginSlug: pinned.pluginSlug,
						contentHash: pinned.contentHash,
					})).status
				: ("not-required" as const);
			return { ...pinned, registrationStatus };
		}),
	).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error))));
});

const processPinnedSandbox = (payload: SandboxExecutionPayload) =>
	processSandboxExecutionQueue(payload);

const completedValue = (result: SandboxExecutionResult, label: string) => {
	const output =
		isObjectRecord(result.value) && result.value["state"] === "completed"
			? result.value["output"]
			: result.value;
	return result.error
		? Effect.fail(sandboxFailure(`${label} failed: ${result.error.phase}: ${result.error.message}`))
		: Schema.decodeUnknownEffect(jsonValueSchema)(
				result.harvest && isObjectRecord(output)
					? (() => {
							const { chunkFiles: _chunkFiles, ...value } = output;
							return { ...value, chunkHandles: result.harvest.chunkHandles };
						})()
					: output,
			).pipe(
				Effect.mapError((error) =>
					sandboxFailure(`${label} returned invalid JSON: ${unknownToMessage(error)}`),
				),
			);
};

export const sandboxWorkflowChildExecutionId = (
	executionId: string,
	name: string,
	requestIndex: number,
) => `${executionId}-child-${sanitizeSandboxExecutionSegment(name)}-${requestIndex}`;

const nondeterminismMessage = (
	index: number,
	entry: WorkflowJournalEntry,
	request: WorkflowDurableCallRequest,
) => {
	const recordedHash = hashWorkflowCallArgs(entry.request.args);
	const requestedHash = hashWorkflowCallArgs(request.args);
	return `SandboxWorkflowNondeterminism: journal[${index}] recorded ${entry.request.kind}:${entry.request.name} args#${recordedHash} but the script requested ${request.kind}:${request.name} args#${requestedHash}`;
};

export const validateWorkflowReplayEnvelope = (
	envelope: WorkflowReplayEnvelope,
	journal: ReadonlyArray<WorkflowJournalEntry>,
): Effect.Effect<ObservedWorkflowReplay, SandboxRunError> => {
	for (let index = 0; index < envelope.requests.length; index += 1) {
		const request = envelope.requests[index];
		if (!request || request.index !== index) {
			return Effect.fail(
				sandboxFailure(
					`SandboxWorkflowNondeterminism: durable call index ${request?.index ?? "missing"} appeared at trace position ${index}`,
				),
			);
		}
		const entry = journal[index];
		if (!entry) {
			break;
		}
		if (
			entry.request.kind !== request.kind ||
			entry.request.name !== request.name ||
			hashWorkflowCallArgs(entry.request.args) !== hashWorkflowCallArgs(request.args)
		) {
			return Effect.fail(sandboxFailure(nondeterminismMessage(index, entry, request)));
		}
	}

	if (
		envelope.state === "pending" &&
		envelope.journalLength !== undefined &&
		envelope.journalLength < journal.length &&
		envelope.requests.length > envelope.journalLength
	) {
		return Effect.succeed({ state: "projection-stale" as const });
	}
	if (envelope.requests.length < journal.length) {
		const entry = journal[envelope.requests.length];
		return Effect.fail(
			sandboxFailure(
				`SandboxWorkflowNondeterminism: replay ended before recorded journal[${envelope.requests.length}] ${entry?.request.kind}:${entry?.request.name}`,
			),
		);
	}
	if (envelope.state === "pending") {
		const requests = envelope.requests.slice(journal.length);
		return requests.length > 0
			? Effect.succeed({
					state: "pending" as const,
					requests: requests.map((request) => ({ request })),
				})
			: Effect.fail(
					sandboxFailure(
						"SandboxWorkflowNondeterminism: pending replay did not include an unrecorded durable call",
					),
				);
	}
	if (envelope.requests.length !== journal.length) {
		return Effect.fail(
			sandboxFailure(
				`SandboxWorkflowNondeterminism: ${envelope.state} replay included an unrecorded durable call`,
			),
		);
	}
	return Effect.succeed(
		envelope.state === "completed"
			? { output: envelope.output, state: "completed" as const }
			: { error: envelope.error, state: "failed" as const },
	);
};

const observeWorkflowReplay = (
	replayValue: unknown,
	journal: ReadonlyArray<WorkflowJournalEntry>,
	workflowScriptId: SandboxScriptId,
	step: number,
) =>
	Activity.make({
		error: SandboxRunError,
		success: ObservedWorkflowReplay,
		name: `observe-sandbox-workflow-replay-${step}`,
		execute: Effect.gen(function* () {
			const envelope = yield* Schema.decodeUnknownEffect(workflowReplayEnvelopeSchema)(
				replayValue,
			).pipe(
				Effect.mapError((error) =>
					sandboxFailure(`Workflow replay envelope is invalid: ${unknownToMessage(error)}`),
				),
			);
			const validated = yield* validateWorkflowReplayEnvelope(envelope, journal);
			if (validated.state !== "pending") {
				return validated;
			}
			const runWithDb = yield* DbRunner;
			const repository = yield* SandboxRepository;
			const requests = yield* Effect.forEach(validated.requests, ({ request }) =>
				Effect.gen(function* () {
					const targetScriptId = yield* runWithDb(
						repository.resolveWorkflowCallScript(workflowScriptId, request),
					);
					if (
						request.kind !== "host" &&
						request.kind !== "sleep" &&
						!(
							(request.kind === "child" || request.kind === "workflow-child") &&
							request.args.workflowSlug.startsWith("kernel:")
						) &&
						targetScriptId === null
					) {
						return yield* sandboxFailure(
							`Workflow ${request.kind} reference could not be resolved`,
						);
					}
					return { request, ...(targetScriptId ? { targetScriptId } : {}) };
				}),
			);
			return { requests, state: "pending" as const };
		}).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error)))),
	});

export const performSandboxWorkflowRequest = Effect.fn("performSandboxWorkflowRequest")(function* <
	R,
>(
	request: WorkflowDurableCallRequest,
	targetScriptId: SandboxScriptId | undefined,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	requestIndex: number,
	processSandbox: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError, R>,
) {
	if (request.kind === "sleep") {
		yield* DurableClock.sleep({
			inMemoryThreshold: Duration.millis(1),
			name: `sandbox-workflow-sleep-${requestIndex}`,
			duration: Duration.millis(request.args.durationMs),
		});
		return null;
	}
	if (request.kind === "host") {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		return yield* dispatcher.dispatch(request, payload, executionId, requestIndex);
	}

	if (request.kind === "activity") {
		return yield* performSandboxWorkflowActivity(
			request,
			targetScriptId,
			payload,
			executionId,
			requestIndex,
			processSandbox,
		);
	}
	const child = yield* Effect.exit(
		performSandboxWorkflowChild(request, targetScriptId, payload, executionId, requestIndex),
	);
	if (request.kind === "child") {
		return child._tag === "Success" ? child.value : yield* Effect.failCause(child.cause);
	}
	if (
		child._tag === "Failure" &&
		(Cause.hasDies(child.cause) || Cause.hasInterrupts(child.cause))
	) {
		return yield* Effect.failCause(child.cause);
	}
	return child._tag === "Success"
		? ({ state: "success", value: child.value } satisfies WorkflowDurableResult)
		: ({
				state: "failure",
				error: { message: unknownToMessage(child.cause) },
			} satisfies WorkflowDurableResult);
});

export const performSandboxWorkflowActivity = Effect.fn("performSandboxWorkflowActivity")(
	function* <R>(
		request: Extract<WorkflowDurableCallRequest, { readonly kind: "activity" }>,
		targetScriptId: SandboxScriptId | undefined,
		payload: SandboxScriptWorkflowPayload,
		executionId: string,
		requestIndex: number,
		processSandbox: (
			payload: SandboxExecutionPayload,
		) => Effect.Effect<SandboxExecutionResult, SandboxRunError, R>,
	) {
		if (!targetScriptId) {
			return yield* sandboxFailure("Workflow activity script was not resolved");
		}
		const result = yield* processSandbox({
			scriptId: targetScriptId,
			context: request.args.input,
			authority: payload.authority,
			workflowExecutionId: executionId,
			...(payload.grants ? { grants: payload.grants } : {}),
			executionId: `${executionId}-activity-${requestIndex}`,
		});
		return yield* completedValue(result, `Workflow activity '${request.name}'`);
	},
);

export const performSandboxWorkflowChild = Effect.fn("performSandboxWorkflowChild")(function* (
	request: Extract<WorkflowDurableCallRequest, { readonly kind: "child" | "workflow-child" }>,
	targetScriptId: SandboxScriptId | undefined,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	requestIndex: number,
) {
	const childExecutionId = sandboxWorkflowChildExecutionId(executionId, request.name, requestIndex);
	const artifactOwnerExecutionId = payload.grants?.artifactOwnerExecutionId ?? executionId;
	const kernel = request.args.workflowSlug.startsWith("kernel:");
	if (!kernel && !targetScriptId) {
		return yield* sandboxFailure("Child workflow script was not resolved");
	}
	const usesArtifacts =
		!kernel || request.args.workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW;
	const dispatchReferenceExecutionId = `${childExecutionId}-artifact-dispatch`;
	const artifactReference = (operation: "release" | "retain") =>
		Activity.make({
			error: SandboxRunError,
			name: `${operation}-sandbox-child-artifacts-${requestIndex}`,
			execute: Effect.gen(function* () {
				const artifacts = yield* SandboxArtifactStore;
				yield* artifacts[operation](artifactOwnerExecutionId, dispatchReferenceExecutionId);
			}).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error)))),
		});
	if (usesArtifacts) {
		yield* artifactReference("retain");
	}

	const child = yield* Effect.exit(
		kernel
			? Effect.flatMap(KernelWorkflowReferences, (references) =>
					references
						.execute(
							request.args.workflowSlug,
							request.args.input,
							payload.authority,
							childExecutionId,
							executionId,
							payload.scriptId,
							artifactOwnerExecutionId,
						)
						.pipe(withoutWorkflowParent),
				)
			: Effect.flatMap(WorkflowEngine, (engine) =>
					engine
						.execute(SandboxScriptWorkflow, {
							executionId: childExecutionId,
							payload: {
								resolutionMode: "exact",
								scriptId: targetScriptId as SandboxScriptId,
								input: request.args.input,
								authority: payload.authority,
								executionId: childExecutionId,
								grants: {
									...payload.grants,
									artifactOwnerExecutionId,
								},
							},
						})
						.pipe(withoutWorkflowParent),
				),
	);
	if (usesArtifacts) {
		const instance = yield* WorkflowInstance;
		if (child._tag === "Success" || !instance.suspended || !Cause.hasInterruptsOnly(child.cause)) {
			yield* artifactReference("release");
		}
	}
	return child._tag === "Success" ? child.value : yield* Effect.failCause(child.cause);
});

export const runSandboxScriptWorkflowBody = Effect.fn("SandboxScriptWorkflow")(function* <R>(
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	processReplay: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError, R>,
) {
	const pin = yield* Activity.make({
		error: SandboxRunError,
		success: SandboxWorkflowPin,
		name: "pin-sandbox-workflow-script",
		execute: Effect.gen(function* () {
			const startedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
			const { scriptId, contentHash, pluginSlug } = yield* establishSandboxWorkflowPin(
				payload,
				executionId,
			);
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.retain(payload.grants?.artifactOwnerExecutionId ?? executionId, executionId);
			return { scriptId, startedAt, pluginSlug, contentHash };
		}).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error)))),
	});

	const releaseReference = Activity.make({
		error: SandboxRunError,
		name: "release-sandbox-workflow-reference",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.release(
				payload.grants?.artifactOwnerExecutionId ?? executionId,
				executionId,
			);
			if (pin.pluginSlug) {
				const runWithDb = yield* DbRunner;
				const references = yield* SandboxWorkflowReferenceRepository;
				yield* runWithDb(references.release(executionId));
			}
		}).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error)))),
	});

	return yield* Effect.gen(function* () {
		const journal: WorkflowJournalEntry[] = [];
		let journalBytes = 2;
		let projectionRetries = 0;
		for (let step = 0; journal.length <= SANDBOX_WORKFLOW_MAX_STEPS; step += 1) {
			yield* projectWorkflowJournal(executionId, journal);
			const replayExecutionId = `${executionId}-replay-${step}`;
			const replay = yield* processReplay({
				context: payload.input,
				scriptId: pin.scriptId,
				startedAt: pin.startedAt,
				authority: payload.authority,
				executionId: replayExecutionId,
				workflowExecutionId: executionId,
				...(payload.grants ? { grants: payload.grants } : {}),
			});
			yield* Effect.forEach(
				replay.logs,
				(message) =>
					Effect.logInfo(message).pipe(
						Effect.annotateLogs({ replayStep: step, sandboxWorkflowExecutionId: executionId }),
					),
				{ discard: true },
			);
			if (replay.error) {
				return yield* sandboxFailure(
					`Workflow replay ${step} failed: ${replay.error.phase}: ${replay.error.message}`,
				);
			}
			const observed = yield* observeWorkflowReplay(replay.value, journal, pin.scriptId, step);
			if (observed.state === "failed") {
				return yield* sandboxFailure(`Workflow replay ${step} failed: ${observed.error}`);
			}
			if (observed.state === "completed") {
				return observed.output;
			}
			if (observed.state === "projection-stale") {
				projectionRetries += 1;
				if (projectionRetries > SANDBOX_WORKFLOW_MAX_PROJECTION_RETRIES) {
					return yield* sandboxFailure(
						`Sandbox workflow projection remained stale after ${SANDBOX_WORKFLOW_MAX_PROJECTION_RETRIES} retries`,
					);
				}
				continue;
			}
			if (journal.length + observed.requests.length > SANDBOX_WORKFLOW_MAX_STEPS) {
				break;
			}
			const values = yield* Effect.forEach(
				observed.requests,
				({ request, targetScriptId }) =>
					performSandboxWorkflowRequest(
						request,
						targetScriptId,
						{ ...payload, scriptId: pin.scriptId, startedAt: pin.startedAt },
						executionId,
						request.index,
						processReplay,
					),
				{ concurrency: SANDBOX_LIMITS.bridge.concurrentHostCalls },
			);
			for (let index = 0; index < observed.requests.length; index += 1) {
				const observedRequest = observed.requests[index];
				const value = values[index];
				if (!observedRequest || value === undefined) {
					return yield* sandboxFailure(
						"Sandbox workflow durable batch returned incomplete results",
					);
				}
				const journalValue = yield* Schema.decodeUnknownEffect(jsonValueSchema)(value).pipe(
					Effect.mapError((error) =>
						sandboxFailure(
							`Sandbox workflow durable result is invalid: ${unknownToMessage(error)}`,
						),
					),
				);
				const entryBytes = jsonByteLength({
					value: journalValue,
					request: observedRequest.request,
				});
				if (
					entryBytes === null ||
					journalBytes + entryBytes + (journal.length === 0 ? 0 : 1) >
						WORKFLOW_SANDBOX_LIMITS.journalBytes
				) {
					return yield* sandboxFailure(
						`Sandbox workflow durable journal exceeds ${WORKFLOW_SANDBOX_LIMITS.journalBytes} UTF-8 bytes`,
					);
				}
				journalBytes += entryBytes + (journal.length === 0 ? 0 : 1);
				journal.push({ value: journalValue, request: observedRequest.request });
			}
		}

		return yield* sandboxFailure(
			`Sandbox workflow exceeded the maximum of ${SANDBOX_WORKFLOW_MAX_STEPS} durable steps`,
		);
	}).pipe(
		Effect.matchCauseEffect({
			onFailure: (cause) =>
				Effect.flatMap(WorkflowInstance, (instance) =>
					instance.suspended && Cause.hasInterruptsOnly(cause)
						? Effect.failCause(cause)
						: releaseReference.pipe(Effect.andThen(Effect.failCause(cause))),
				),
			onSuccess: (output) => releaseReference.pipe(Effect.as(output)),
		}),
	);
});

export const runSandboxScriptWorkflow = Effect.fn("SandboxScriptWorkflow")(function* (
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
) {
	return yield* runSandboxScriptWorkflowBody(payload, executionId, processPinnedSandbox);
});
