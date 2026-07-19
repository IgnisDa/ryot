import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import {
	ExecutionAuthority,
	type SandboxCompletedResult,
	SandboxExecutionGrants,
	type SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import {
	type WorkflowReplayEnvelope,
	workflowDurableCallRequestSchema,
	workflowReplayEnvelopeSchema,
	type WorkflowDurableCallRequest,
} from "@ryot/sandbox-sdk/workflow";
import { Cause, Duration, Effect, Schema } from "effect";
import { Activity, DurableClock, Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	hashWorkflowCallArgs,
	projectWorkflowJournal,
	type WorkflowJournalEntry,
} from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import { type DurableSchema, withoutWorkflowParent } from "#lib/infrastructure/workflow";

import { resolveSandboxExecutionPayload } from "./durable-queues";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";
import { RunSandboxWorkflow } from "./sandbox-run-workflow";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

export const SANDBOX_WORKFLOW_MAX_STEPS = 1_000;

const SandboxWorkflowPin = Schema.Struct({
	scriptId: SandboxScriptId,
	contentHash: Schema.String,
	pluginSlug: Schema.NullOr(Schema.String),
});

const ObservedWorkflowReplay = Schema.Union([
	Schema.Struct({ output: jsonValueSchema, state: Schema.Literal("completed") }),
	Schema.Struct({ error: Schema.String, state: Schema.Literal("failed") }),
	Schema.Struct({
		request: workflowDurableCallRequestSchema,
		state: Schema.Literal("pending"),
		targetScriptId: Schema.optional(SandboxScriptId),
	}),
]);
type ObservedWorkflowReplay = Schema.Schema.Type<typeof ObservedWorkflowReplay>;

export const SandboxScriptWorkflowPayload = Schema.Struct({
	input: jsonValueSchema,
	scriptId: SandboxScriptId,
	executionId: Schema.String,
	authority: ExecutionAuthority,
	grants: Schema.optional(SandboxExecutionGrants),
	resolutionMode: Schema.Literals(["active", "exact"]),
	// Effect injects this into child payloads before strict excess-property decoding.
	"~@effect/workflow/parent": Schema.optional(Schema.Unknown),
}).annotate({ parseOptions: { onExcessProperty: "error" as const } });

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
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		return yield* engine
			.execute(RunSandboxWorkflow, { payload, executionId: payload.executionId })
			.pipe(withoutWorkflowParent);
	});

const completedValue = (result: SandboxCompletedResult, label: string) =>
	result.error
		? Effect.fail(sandboxFailure(`${label} failed: ${result.error.phase}: ${result.error.message}`))
		: Schema.decodeUnknownEffect(jsonValueSchema)(
				result.harvest && typeof result.value === "object" && result.value !== null
					? { ...result.value, chunkFiles: result.harvest.chunkPaths }
					: result.value,
			).pipe(
				Effect.mapError((error) =>
					sandboxFailure(`${label} returned invalid JSON: ${unknownToMessage(error)}`),
				),
			);

export const sandboxWorkflowChildExecutionId = (executionId: string, name: string, step: number) =>
	`${executionId}-child-${name}-${step}`;

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

	if (envelope.requests.length < journal.length) {
		const entry = journal[envelope.requests.length];
		return Effect.fail(
			sandboxFailure(
				`SandboxWorkflowNondeterminism: replay ended before recorded journal[${envelope.requests.length}] ${entry?.request.kind}:${entry?.request.name}`,
			),
		);
	}
	if (envelope.requests.length > journal.length + 1) {
		return Effect.fail(
			sandboxFailure(
				`SandboxWorkflowNondeterminism: replay crossed more than one unrecorded durable call`,
			),
		);
	}

	if (envelope.state === "pending") {
		const request = envelope.requests[journal.length];
		return request && envelope.requests.length === journal.length + 1
			? Effect.succeed({ request, state: "pending" as const })
			: Effect.fail(
					sandboxFailure(
						"SandboxWorkflowNondeterminism: pending replay did not end at its first missing call",
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
			const targetScriptId = yield* runWithDb(
				repository.resolveWorkflowCallScript(workflowScriptId, validated.request),
			);
			if (
				validated.request.kind !== "sleep" &&
				!(
					validated.request.kind === "child" &&
					validated.request.args.workflowSlug.startsWith("kernel:")
				) &&
				targetScriptId === null
			) {
				return yield* sandboxFailure(
					`Workflow ${validated.request.kind} reference could not be resolved`,
				);
			}
			return { ...validated, ...(targetScriptId ? { targetScriptId } : {}) };
		}).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error)))),
	});

export const performSandboxWorkflowRequest = Effect.fn("performSandboxWorkflowRequest")(function* <
	R,
>(
	request: WorkflowDurableCallRequest,
	targetScriptId: SandboxScriptId | undefined,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	step: number,
	processSandbox: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, R>,
) {
	if (request.kind === "sleep") {
		yield* DurableClock.sleep({
			name: `sandbox-workflow-sleep-${step}`,
			inMemoryThreshold: Duration.millis(1),
			duration: Duration.millis(request.args.durationMs),
		});
		return null;
	}

	if (request.kind === "activity") {
		return yield* performSandboxWorkflowActivity(
			request,
			targetScriptId,
			payload,
			executionId,
			step,
			processSandbox,
		);
	}
	return yield* performSandboxWorkflowChild(request, targetScriptId, payload, executionId, step);
});

export const performSandboxWorkflowActivity = Effect.fn("performSandboxWorkflowActivity")(
	function* <R>(
		request: Extract<WorkflowDurableCallRequest, { readonly kind: "activity" }>,
		targetScriptId: SandboxScriptId | undefined,
		payload: SandboxScriptWorkflowPayload,
		executionId: string,
		step: number,
		processSandbox: (
			payload: SandboxExecutionPayload,
		) => Effect.Effect<SandboxCompletedResult, SandboxRunError, R>,
	) {
		if (!targetScriptId) {
			return yield* sandboxFailure("Workflow activity script was not resolved");
		}
		const result = yield* processSandbox({
			authority: payload.authority,
			context: request.args.input,
			scriptId: targetScriptId,
			executionId: `${executionId}-activity-${step}`,
			...(payload.grants ? { grants: payload.grants } : {}),
		});
		return yield* completedValue(result, `Workflow activity '${request.name}'`);
	},
);

export const performSandboxWorkflowChild = Effect.fn("performSandboxWorkflowChild")(function* (
	request: Extract<WorkflowDurableCallRequest, { readonly kind: "child" }>,
	targetScriptId: SandboxScriptId | undefined,
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	step: number,
) {
	const childExecutionId = sandboxWorkflowChildExecutionId(executionId, request.name, step);
	if (request.args.workflowSlug.startsWith("kernel:")) {
		const references = yield* KernelWorkflowReferences;
		return yield* references
			.execute(
				request.args.workflowSlug,
				request.args.input,
				payload.authority,
				childExecutionId,
				executionId,
				payload.scriptId,
			)
			.pipe(withoutWorkflowParent);
	}
	if (!targetScriptId) {
		return yield* sandboxFailure("Child workflow script was not resolved");
	}
	const engine = yield* WorkflowEngine;
	return yield* engine
		.execute(SandboxScriptWorkflow, {
			executionId: childExecutionId,
			payload: {
				resolutionMode: "exact",
				scriptId: targetScriptId,
				input: request.args.input,
				authority: payload.authority,
				executionId: childExecutionId,
				...(payload.grants ? { grants: payload.grants } : {}),
			},
		})
		.pipe(withoutWorkflowParent);
});

export const runSandboxScriptWorkflowBody = Effect.fn("SandboxScriptWorkflow")(function* <R>(
	payload: SandboxScriptWorkflowPayload,
	executionId: string,
	processReplay: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, R>,
) {
	const pin = yield* Activity.make({
		error: SandboxRunError,
		success: SandboxWorkflowPin,
		name: "pin-sandbox-workflow-script",
		execute: establishSandboxWorkflowPin(payload, executionId).pipe(
			Effect.map(({ scriptId, contentHash, pluginSlug }) => ({
				scriptId,
				pluginSlug,
				contentHash,
			})),
		),
	});

	const releaseReference = pin.pluginSlug
		? Activity.make({
				error: SandboxRunError,
				name: "release-sandbox-workflow-reference",
				execute: Effect.gen(function* () {
					const runWithDb = yield* DbRunner;
					const references = yield* SandboxWorkflowReferenceRepository;
					yield* runWithDb(references.release(executionId));
				}).pipe(Effect.mapError((error) => sandboxFailure(unknownToMessage(error)))),
			})
		: Effect.void;

	return yield* Effect.gen(function* () {
		const journal: WorkflowJournalEntry[] = [];
		for (let step = 0; step <= SANDBOX_WORKFLOW_MAX_STEPS; step += 1) {
			yield* projectWorkflowJournal(executionId, journal);
			const replayExecutionId = `${executionId}-replay-${step}`;
			const replay = yield* processReplay({
				context: payload.input,
				scriptId: pin.scriptId,
				authority: payload.authority,
				executionId: replayExecutionId,
				...(payload.grants ? { grants: payload.grants } : {}),
			});
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
			if (step === SANDBOX_WORKFLOW_MAX_STEPS) {
				break;
			}
			const value = yield* performSandboxWorkflowRequest(
				observed.request,
				observed.targetScriptId,
				{ ...payload, scriptId: pin.scriptId },
				executionId,
				step,
				processReplay,
			);
			journal.push({ value, request: observed.request });
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
