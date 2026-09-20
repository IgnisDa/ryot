import { SandboxFailureKind, SandboxRunError, unknownToMessage } from "@ryot-app/contract/errors";
import { KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW } from "@ryot-app/contract/modules/plugins/execution";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { jsonByteLength } from "@ryot-app/sandbox-compiler/limits";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	type WorkflowDurableResult,
	type WorkflowReplayEnvelope,
	workflowDurableCallRequestSchema,
	workflowDurableResultSchema,
	workflowReplayEnvelopeSchema,
	workflowReplayJournalEntrySchema,
	type WorkflowDurableCallRequest,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Cause, Clock, Context, Duration, Effect, Exit, Layer, Option, Schema } from "effect";
import { DurableClock, DurableDeferred, Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	recordSandboxWorkflowReplayFinished,
	sandboxMetricKind,
	type SandboxReplayOutcome,
} from "#lib/infrastructure/runtime-metrics";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { isDeclaredExecutableCall } from "#lib/infrastructure/sandbox-runtime/executable-dependencies";
import {
	SandboxExecutionPrincipal,
	sandboxSubjectUserId,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { sanitizeSandboxExecutionSegment } from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import type { SandboxHttpProgress } from "#lib/infrastructure/sandbox-runtime/http-progress";
import type { SandboxInlineProgress } from "#lib/infrastructure/sandbox-runtime/inline-progress";
import {
	SANDBOX_LIMITS,
	sandboxWorkflowJournalByteError,
} from "#lib/infrastructure/sandbox-runtime/limits";
import { sandboxStartedAt } from "#lib/infrastructure/sandbox-runtime/shared";
import {
	hashWorkflowCallArgs,
	appendWorkflowJournal,
} from "#lib/infrastructure/sandbox-runtime/workflow-journal";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import {
	processSandboxExecutionQueue,
	type SandboxProjectionMissing,
	sandboxRecoveryExecutionId,
	type SandboxExecutionQueuePayload,
	type SandboxExecutionResolutionMode,
	type SandboxReplayResult,
} from "./durable-queues";
import {
	SandboxExecutionResult as SandboxExecutionResultSchema,
	type SandboxExecutionResult,
} from "./execution-result";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxPluginScriptResolver } from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import {
	type PinnedSandboxScriptWorkflowPayload,
	SandboxScriptWorkflowPayload,
	type SandboxScriptWorkflowPayload as SandboxScriptWorkflowPayloadValue,
} from "./sandbox-script-workflow-payload";
import {
	SandboxWorkflowReferenceRegistrationError,
	SandboxWorkflowReferenceRepository,
} from "./workflow-reference-repository";

const SANDBOX_WORKFLOW_MAX_STEPS = 1_000;
const SANDBOX_WORKFLOW_MAX_PROJECTION_REBUILDS = 2;

const SandboxWorkflowPin = Schema.Struct({
	startedAt: Schema.String,
	principal: SandboxExecutionPrincipal,
});

const ObservedWorkflowReplay = Schema.Union([
	Schema.Struct({
		error: Schema.String,
		kind: SandboxFailureKind,
		state: Schema.Literal("failed"),
	}),
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

const SettledWorkflowRequest = Schema.Struct({
	entry: workflowReplayJournalEntrySchema,
	targetScriptId: Schema.NullOr(SandboxScriptId),
});

export const SandboxScriptWorkflow = Workflow.make("SandboxScriptWorkflow", {
	error: SandboxRunError satisfies DurableSchema,
	success: jsonValueSchema satisfies DurableSchema,
	idempotencyKey: ({ executionId }) => executionId,
	payload: SandboxScriptWorkflowPayload satisfies DurableSchema,
});

const sandboxFailure = (kind: SandboxFailureKind, message: string) =>
	new SandboxRunError({ kind, message });

const decodeDurableResult = (value: unknown) =>
	Schema.decodeUnknownEffect(jsonValueSchema)(value).pipe(
		Effect.mapError((error) =>
			sandboxFailure(
				"invalid-output",
				`Sandbox workflow durable result is invalid: ${unknownToMessage(error)}`,
			),
		),
	);

// An already-classified failure keeps its kind; only unclassified causes take the fallback.
const rethrowSandboxFailure = (fallback: SandboxFailureKind) => (error: unknown) =>
	error instanceof SandboxRunError
		? error
		: sandboxFailure(
				error instanceof SandboxWorkflowReferenceRegistrationError ? "missing-artifact" : fallback,
				unknownToMessage(error),
			);

const accountGenerationOf = ({ subject }: SandboxScriptWorkflowPayloadValue) =>
	subject.type === "system" ? null : subject.accountGeneration;

const artifactOwnerOf = (payload: SandboxScriptWorkflowPayloadValue, executionId: string) =>
	payload.grants?.artifactOwnerExecutionId ?? executionId;

const withHarvestedChunks = (
	output: Record<string, unknown>,
	chunkHandles: ReadonlyArray<string>,
) => {
	const { chunkFiles: _chunkFiles, ...rest } = output;
	return { ...rest, chunkHandles };
};

const installationUnavailable = (data: NonNullable<SandboxExecutionResult["error"]>["data"]) =>
	data?.code === "package-identity-conflict" || data?.code === "installation-unavailable";

const toSandboxExecutionResult = (
	result: SandboxExecutionResult,
	value: JsonValue,
	error: SandboxExecutionResult["error"] = null,
) => ({
	value,
	logs: result.logs,
	status: "completed" as const,
	...(result.timing ? { timing: result.timing } : {}),
	error:
		error === null
			? null
			: {
					kind: installationUnavailable(error.data) ? "resource-unavailable" : error.kind,
					phase: error.phase,
					message: error.message,
					...(error.data === undefined ? {} : { data: error.data }),
					...(error.line === undefined ? {} : { line: error.line }),
					...(error.stack === undefined ? {} : { stack: error.stack }),
					...(error.column === undefined ? {} : { column: error.column }),
				},
});

const pinningOwnership = (payload: SandboxScriptWorkflowPayloadValue) => {
	const { subject } = payload;
	if (subject.type !== "automation-run") {
		return {
			conflicts: false,
			userId: sandboxSubjectUserId(subject),
			expectedRevision: payload.pluginRevision,
		};
	}
	return {
		userId: subject.executionUserId,
		expectedRevision:
			subject.pluginId === null
				? undefined
				: {
						id: subject.pluginId,
						revisionId: subject.pluginRevisionId,
						configRevisionId: subject.pluginConfigRevisionId,
					},
		conflicts:
			payload.pluginRevision !== undefined &&
			(payload.pluginRevision.id !== subject.pluginId ||
				payload.pluginRevision.revisionId !== subject.pluginRevisionId ||
				payload.pluginRevision.configRevisionId !== subject.pluginConfigRevisionId),
	};
};

export class SandboxWorkflowPinning extends Context.Service<SandboxWorkflowPinning>()(
	"SandboxWorkflowPinning",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const receipts = yield* MutationReceipts.make;
			const repository = yield* SandboxRepository;
			const references = yield* SandboxWorkflowReferenceRepository;
			const pluginScriptResolver = yield* SandboxPluginScriptResolver;

			const resolvePayload = Effect.fn("SandboxWorkflowPinning.resolvePayload")(function* (
				payload: SandboxExecutionPayload,
				mode: SandboxExecutionResolutionMode,
			) {
				if (mode === "exact") {
					return payload;
				}
				const pluginOwned = yield* repository.isPluginScript(payload.scriptId);
				if (!pluginOwned) {
					return payload;
				}

				const activeScript = yield* pluginScriptResolver.findActiveScriptById(
					payload.scriptId,
					sandboxSubjectUserId(payload.subject),
				);
				if (!activeScript) {
					return yield* new SandboxRunError({
						kind: "missing-artifact",
						message: "Sandbox script not found",
					});
				}
				return { ...payload, scriptId: activeScript.id };
			});

			const establish = Effect.fn("SandboxWorkflowPinning.establish")(function* (
				payload: SandboxScriptWorkflowPayloadValue,
				executionId: string,
				expectedPluginId?: string,
				retain?: (principal: SandboxExecutionPrincipal) => Effect.Effect<void, SandboxRunError>,
			) {
				return yield* database
					.transaction(
						Effect.gen(function* () {
							yield* references.lockIngestionShared();
							const subject = payload.subject;
							yield* admitWorkflow(
								receipts,
								SandboxScriptWorkflow,
								accountGenerationOf(payload),
								executionId,
							);
							const ownership = pinningOwnership(payload);
							if (ownership.conflicts) {
								return yield* sandboxFailure(
									"script-failure",
									"Sandbox workflow pin conflicts with automation ownership",
								);
							}
							const resolved = yield* resolvePayload(
								{
									context: payload.input,
									subject: payload.subject,
									scriptId: payload.scriptId,
									executionId: payload.executionId,
									...(payload.grants ? { grants: payload.grants } : {}),
								},
								payload.pluginRevision || subject.type === "automation-run"
									? "exact"
									: payload.resolutionMode,
							);
							const pinned = yield* repository.getScriptPin(
								resolved.scriptId,
								ownership.expectedRevision,
								subject,
								payload.initialization,
							);
							if (!pinned) {
								return yield* sandboxFailure(
									"missing-artifact",
									"Sandbox workflow script not found",
								);
							}
							if (
								subject.type === "automation-run" &&
								subject.pluginId === null &&
								pinned.pluginRevision !== null
							) {
								return yield* sandboxFailure(
									"missing-artifact",
									"Kernel automation requires a source-zero script",
								);
							}
							const { userId } = ownership;
							if (
								pinned.pluginRevision?.scope === "user" &&
								pinned.pluginRevision.ownerId !== userId
							) {
								return yield* sandboxFailure(
									"script-failure",
									"Sandbox workflow plugin owner does not match execution user",
								);
							}
							if (expectedPluginId && pinned.pluginRevision?.id !== expectedPluginId) {
								return yield* sandboxFailure(
									"script-failure",
									`Sandbox workflow script is not owned by plugin '${expectedPluginId}'`,
								);
							}
							const principal = {
								...pinned,
								subject: payload.subject,
							} satisfies SandboxExecutionPrincipal;
							const initialization = "initialization" in pinned ? pinned.initialization : undefined;
							if (retain) {
								yield* retain(principal);
							}
							const registrationStatus = principal.pluginRevision
								? (yield* references.registerInTransaction({
										executionId,
										scriptId: principal.scriptId,
										contentHash: principal.contentHash,
										pluginId: principal.pluginRevision.id,
										...(ownership.expectedRevision
											? { expectedRevision: ownership.expectedRevision }
											: {}),
										...(initialization ? { initialization } : {}),
										...(subject.type === "automation-run" ? { allowInactive: true } : {}),
										...(userId === null ? {} : { userId }),
									})).status
								: ("not-required" as const);
							return { principal, registrationStatus };
						}),
					)
					.pipe(Effect.mapError(rethrowSandboxFailure("infrastructure")));
			});

			return { establish, resolvePayload };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const processPinnedSandbox = Effect.fn("processPinnedSandbox")(function* (
	payload: SandboxExecutionQueuePayload,
) {
	for (let attempt = 0; ; attempt++) {
		const result = yield* processSandboxExecutionQueue({
			...payload,
			recoveryAttempt: attempt,
		}).pipe(
			Effect.asSome,
			Effect.catchTag("SandboxRecoverySuspended", () => Effect.succeedNone),
		);
		if (Option.isSome(result)) {
			return result.value;
		}
		yield* DurableClock.sleep({
			duration: "60 seconds",
			inMemoryThreshold: Duration.millis(1),
			name: sandboxRecoveryExecutionId(payload.executionId, attempt),
		});
	}
});

export const sandboxWorkflowChildExecutionId = (executionId: string, name: string, index: number) =>
	`${executionId}-child-${sanitizeSandboxExecutionSegment(name)}-${index}`;

const nondeterminismMessage = (
	index: number,
	entry: WorkflowReplayJournalEntry,
	request: WorkflowDurableCallRequest,
) => {
	const recordedHash = hashWorkflowCallArgs(entry.request.args);
	const requestedHash = hashWorkflowCallArgs(request.args);
	return `SandboxWorkflowNondeterminism: journal[${index}] recorded ${entry.request.kind}:${entry.request.name} args#${recordedHash} but the script requested ${request.kind}:${request.name} args#${requestedHash}`;
};

const sameRequestIdentity = (
	recorded: WorkflowDurableCallRequest,
	requested: WorkflowDurableCallRequest,
) =>
	recorded.index === requested.index &&
	recorded.kind === requested.kind &&
	recorded.name === requested.name &&
	hashWorkflowCallArgs(recorded.args) === hashWorkflowCallArgs(requested.args);

/**
 * `inline` holds the entries the replay settled after the journal it loaded; the envelope must
 * list their requests at the same positions, so they join the journal only in replay order.
 */
export const validateWorkflowReplayEnvelope = (
	envelope: WorkflowReplayEnvelope,
	journal: ReadonlyArray<WorkflowReplayJournalEntry>,
	inline: ReadonlyArray<WorkflowReplayJournalEntry>,
): Effect.Effect<ObservedWorkflowReplay, SandboxRunError> => {
	if (envelope.journalLength !== journal.length) {
		return Effect.fail(
			sandboxFailure(
				"infrastructure",
				`Sandbox workflow replay loaded ${envelope.journalLength} journal entries; expected ${journal.length}`,
			),
		);
	}
	const recorded = [...journal, ...inline];
	for (let index = 0; index < envelope.requests.length; index += 1) {
		const request = envelope.requests[index];
		if (!request || request.index !== index) {
			return Effect.fail(
				sandboxFailure(
					"script-failure",
					`SandboxWorkflowNondeterminism: durable call index ${request?.index ?? "missing"} appeared at trace position ${index}`,
				),
			);
		}
		const entry = recorded[index];
		if (!entry) {
			continue;
		}
		if (!sameRequestIdentity(entry.request, request)) {
			return Effect.fail(
				sandboxFailure("script-failure", nondeterminismMessage(index, entry, request)),
			);
		}
	}

	if (envelope.requests.length < recorded.length) {
		const entry = recorded[envelope.requests.length];
		return Effect.fail(
			sandboxFailure(
				"script-failure",
				`SandboxWorkflowNondeterminism: replay ended before recorded journal[${envelope.requests.length}] ${entry?.request.kind}:${entry?.request.name}`,
			),
		);
	}
	if (envelope.state === "pending") {
		const requests = envelope.requests.slice(recorded.length);
		return requests.length > 0
			? Effect.succeed({
					state: "pending" as const,
					requests: requests.map((request) => ({ request })),
				})
			: Effect.fail(
					sandboxFailure(
						"script-failure",
						"SandboxWorkflowNondeterminism: pending replay did not include an unrecorded durable call",
					),
				);
	}
	if (envelope.requests.length !== recorded.length) {
		const failure = envelope.state === "failed" ? `: ${envelope.error}` : "";
		return Effect.fail(
			sandboxFailure(
				"script-failure",
				`SandboxWorkflowNondeterminism: ${envelope.state} replay included an unrecorded durable call${failure}`,
			),
		);
	}
	return Effect.succeed(
		envelope.state === "completed"
			? { output: envelope.output, state: "completed" as const }
			: { kind: envelope.kind, error: envelope.error, state: "failed" as const },
	);
};

const observeWorkflowReplay = Effect.fnUntraced(function* (
	replayValue: unknown,
	journal: ReadonlyArray<WorkflowReplayJournalEntry>,
	inline: ReadonlyArray<WorkflowReplayJournalEntry>,
	pluginRevision: SandboxExecutionPrincipal["pluginRevision"],
	metadata: SandboxExecutionPrincipal["metadata"],
	step: number,
) {
	const envelope = yield* Schema.decodeUnknownEffect(workflowReplayEnvelopeSchema)(
		replayValue,
	).pipe(
		Effect.mapError((error) =>
			sandboxFailure(
				"script-failure",
				`Workflow replay envelope is invalid: ${unknownToMessage(error)}`,
			),
		),
	);
	// The activity pins targets; the current envelope must be checked on every body activation.
	const validated = yield* validateWorkflowReplayEnvelope(envelope, journal, inline);
	for (const request of envelope.requests) {
		if (!isDeclaredExecutableCall(metadata, request)) {
			return yield* sandboxFailure(
				"script-failure",
				"Executable target is not declared by this script",
			);
		}
	}
	const observed = yield* makeActivity({
		error: SandboxRunError,
		success: ObservedWorkflowReplay,
		name: `observe-sandbox-workflow-replay-${step}`,
		execute: Effect.gen(function* () {
			if (validated.state !== "pending") {
				return validated;
			}
			const repository = yield* SandboxRepository;
			const requests = yield* Effect.forEach(validated.requests, ({ request }) =>
				Effect.gen(function* () {
					const target = yield* repository.resolveWorkflowCallScript(pluginRevision, request);
					if (
						request.kind !== "host" &&
						request.kind !== "sleep" &&
						!(
							(request.kind === "child" || request.kind === "workflow-child") &&
							request.args.workflowSlug.startsWith("kernel:")
						) &&
						target === null
					) {
						return yield* sandboxFailure(
							"missing-artifact",
							`Workflow ${request.kind} reference could not be resolved`,
						);
					}
					return target ? { request, targetScriptId: target.scriptId } : { request };
				}),
			);
			return { requests, state: "pending" as const };
		}).pipe(Effect.mapError(rethrowSandboxFailure("infrastructure"))),
	});
	if (validated.state === "pending" && observed.state === "pending") {
		if (
			validated.requests.length !== observed.requests.length ||
			validated.requests.some(({ request }, index) => {
				const pinned = observed.requests[index];
				return !pinned || !sameRequestIdentity(pinned.request, request);
			})
		) {
			return yield* sandboxFailure(
				"script-failure",
				"SandboxWorkflowNondeterminism: replay requests do not match the pinned observation",
			);
		}
	} else if (stableStringify(validated) !== stableStringify(observed)) {
		return yield* sandboxFailure(
			"script-failure",
			"SandboxWorkflowNondeterminism: replay outcome does not match the pinned observation",
		);
	}
	return observed;
});

export const performSandboxWorkflowRequest = Effect.fn("performSandboxWorkflowRequest")(function* (
	request: WorkflowDurableCallRequest,
	targetScriptId: SandboxScriptId | undefined,
	payload: PinnedSandboxScriptWorkflowPayload,
	principal: SandboxExecutionPrincipal,
	executionId: string,
	progress?: SandboxHttpProgress,
) {
	if (request.kind === "sleep") {
		yield* DurableClock.sleep({
			inMemoryThreshold: Duration.millis(1),
			name: `sandbox-workflow-sleep-${request.index}`,
			duration: Duration.millis(request.args.durationMs),
		});
		return null;
	}
	if (request.kind === "host") {
		const dispatcher = yield* SandboxDurableHostDispatcher;
		return yield* dispatcher.dispatch(request, payload, principal, executionId, progress);
	}
	const childPayload = {
		...payload,
		...(principal.pluginRevision ? { pluginRevision: principal.pluginRevision } : {}),
	};

	if (request.kind === "activity") {
		return yield* performSandboxWorkflowChild(
			{
				name: request.name,
				index: request.index,
				kind: "workflow-child",
				args: { input: request.args.input, workflowSlug: request.args.scriptSlug },
			},
			targetScriptId,
			childPayload,
			executionId,
			principal,
		);
	}
	const child = yield* Effect.exit(
		performSandboxWorkflowChild(request, targetScriptId, childPayload, executionId, principal),
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

export const performSandboxWorkflowChild = Effect.fn("performSandboxWorkflowChild")(function* (
	request: Extract<WorkflowDurableCallRequest, { readonly kind: "child" | "workflow-child" }>,
	targetScriptId: SandboxScriptId | undefined,
	payload: SandboxScriptWorkflowPayloadValue,
	executionId: string,
	callerAuthority: SandboxExecutionPrincipal,
) {
	const childExecutionId = sandboxWorkflowChildExecutionId(
		executionId,
		request.name,
		request.index,
	);
	const artifactOwnerExecutionId = artifactOwnerOf(payload, executionId);
	const kernel = request.args.workflowSlug.startsWith("kernel:");
	if (!kernel && !targetScriptId) {
		return yield* sandboxFailure("missing-artifact", "Child workflow script was not resolved");
	}
	const usesArtifacts =
		!kernel || request.args.workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW;
	const dispatchReferenceExecutionId = `${childExecutionId}-artifact-dispatch`;
	const artifactReference = (operation: "release" | "retain") =>
		makeActivity({
			error: SandboxRunError,
			name: `${operation}-sandbox-child-artifacts-${request.index}`,
			execute: Effect.gen(function* () {
				const artifacts = yield* SandboxArtifactStore;
				yield* artifacts[operation](artifactOwnerExecutionId, dispatchReferenceExecutionId);
			}).pipe(Effect.mapError(rethrowSandboxFailure("infrastructure"))),
		});
	if (usesArtifacts) {
		yield* artifactReference("retain");
	}
	const receipts = yield* MutationReceipts.make;

	const child = yield* Effect.exit(
		kernel
			? Effect.flatMap(KernelWorkflowReferences, (references) =>
					references.execute(
						request.args.workflowSlug,
						request.args.input,
						payload.subject,
						payload.lane,
						childExecutionId,
						executionId,
						callerAuthority,
						artifactOwnerExecutionId,
					),
				)
			: Effect.flatMap(WorkflowEngine, (engine) =>
					targetScriptId === undefined
						? Effect.fail(
								sandboxFailure("missing-artifact", "Child workflow script was not resolved"),
							)
						: dispatchAdmittedWorkflow(
								receipts,
								engine,
								SandboxScriptWorkflow,
								accountGenerationOf(payload),
								{
									executionId: childExecutionId,
									payload: {
										lane: payload.lane,
										resolutionMode: "exact",
										subject: payload.subject,
										input: request.args.input,
										executionId: childExecutionId,
										scriptId: SandboxScriptId.make(targetScriptId),
										grants: { ...payload.grants, artifactOwnerExecutionId },
										...(payload.pluginRevision ? { pluginRevision: payload.pluginRevision } : {}),
									},
								},
								(admission) =>
									admission.pipe(Effect.mapError(rethrowSandboxFailure("infrastructure"))),
								(dispatch) => dispatch,
							),
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

type ObservedRequest = Extract<ObservedWorkflowReplay, { state: "pending" }>["requests"][number];

interface WorkflowRunScope {
	readonly executionId: string;
	readonly instance: Context.Service.Shape<typeof WorkflowInstance>;
	readonly payload: SandboxScriptWorkflowPayloadValue;
	readonly pin: typeof SandboxWorkflowPin.Type;
}

const settleSandboxRequest = Effect.fnUntraced(function* (
	{ pin, payload, instance, executionId }: WorkflowRunScope,
	{ request, targetScriptId }: ObservedRequest,
	pending: SandboxInlineProgress | undefined,
) {
	const engine = yield* WorkflowEngine;
	const deferred = DurableDeferred.make(`sandbox-request-${request.index}`, {
		success: SettledWorkflowRequest,
	});
	const stored = yield* engine
		.deferredResult(deferred)
		.pipe(Effect.provideService(WorkflowInstance, instance));
	if (Option.isSome(stored)) {
		const settled = yield* stored.value;
		if (
			!sameRequestIdentity(settled.entry.request, request) ||
			settled.targetScriptId !== (targetScriptId ?? null)
		) {
			return yield* sandboxFailure(
				"script-failure",
				`SandboxWorkflowNondeterminism: settled request[${request.index}] identity or pinned target changed`,
			);
		}
		return settled.entry.value;
	}
	return yield* Effect.uninterruptibleMask((restore) =>
		Effect.gen(function* () {
			const value = yield* restore(
				pending?._tag === "Completed"
					? Effect.succeed(pending.value)
					: performSandboxWorkflowRequest(
							request,
							targetScriptId,
							{ ...payload, startedAt: pin.startedAt, scriptId: pin.principal.scriptId },
							pin.principal,
							executionId,
							pending?._tag === "Http" ? pending.progress : undefined,
						).pipe(Effect.provideService(WorkflowInstance, instance)),
			);
			const jsonValue = yield* decodeDurableResult(value);
			// A sibling suspension must not interrupt the completion write after dispatch has returned.
			yield* engine
				.deferredDone(deferred, {
					deferredName: deferred.name,
					executionId: instance.executionId,
					workflowName: instance.workflow._tag,
					exit: Exit.succeed({
						entry: { request, value: jsonValue },
						targetScriptId: targetScriptId ?? null,
					}),
				})
				.pipe(Effect.provideService(WorkflowInstance, instance));
			return jsonValue;
		}),
	);
});

const makeReplayJournal = () => {
	const entries: WorkflowReplayJournalEntry[] = [];
	let bytes = 2;
	const append = Effect.fnUntraced(function* (request: WorkflowDurableCallRequest, value: unknown) {
		const journalValue = yield* decodeDurableResult(value);
		const entryBytes = jsonByteLength({ request, value: journalValue });
		if (entryBytes === null) {
			return yield* sandboxFailure(
				"script-failure",
				`Sandbox workflow durable journal exceeds ${SANDBOX_LIMITS.journalBytes} UTF-8 bytes`,
			);
		}
		const journalByteError = sandboxWorkflowJournalByteError(bytes, entryBytes, entries.length);
		if (journalByteError) {
			return yield* sandboxFailure("script-failure", journalByteError);
		}
		bytes += entryBytes + (entries.length === 0 ? 0 : 1);
		entries.push({ request, value: journalValue });
		return undefined;
	});
	return {
		append,
		entries,
		get bytes() {
			return bytes;
		},
	};
};

const validatePendingInline = Effect.fnUntraced(function* (
	replay: SandboxReplayResult,
	observed: ObservedWorkflowReplay,
) {
	const pending = new Map<number, SandboxInlineProgress>();
	for (const entry of replay.pendingInline) {
		const request =
			observed.state === "pending"
				? observed.requests.find((candidate) => candidate.request.index === entry.request.index)
						?.request
				: undefined;
		if (
			!request ||
			pending.has(request.index) ||
			!sameRequestIdentity(request, entry.request) ||
			(entry._tag === "Http" && entry.request.args.capability !== "httpCall")
		) {
			return yield* sandboxFailure(
				"script-failure",
				"Sandbox inline progress does not match the pending replay",
			);
		}
		if (entry._tag === "Completed") {
			yield* Schema.decodeUnknownEffect(
				request.kind === "sleep" ? Schema.Null : workflowDurableResultSchema,
			)(entry.value).pipe(
				Effect.mapError((error) => sandboxFailure("infrastructure", unknownToMessage(error))),
			);
		}
		pending.set(request.index, entry);
	}
	return pending;
});

export const runSandboxScriptWorkflowBody = Effect.fn("SandboxScriptWorkflow")(function* <R>(
	payload: SandboxScriptWorkflowPayloadValue,
	executionId: string,
	processReplay: (
		payload: SandboxExecutionQueuePayload,
	) => Effect.Effect<SandboxReplayResult, SandboxRunError | SandboxProjectionMissing, R>,
) {
	const pin = yield* makeActivity({
		error: SandboxRunError,
		success: SandboxWorkflowPin,
		name: "pin-sandbox-workflow-script",
		execute: Effect.gen(function* () {
			const startedAt = yield* sandboxStartedAt;
			const pinning = yield* SandboxWorkflowPinning;
			const { principal } = yield* pinning.establish(payload, executionId);
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.retain(artifactOwnerOf(payload, executionId), executionId);
			return { startedAt, principal };
		}).pipe(Effect.mapError(rethrowSandboxFailure("infrastructure"))),
	});

	const releaseReference = makeActivity({
		error: SandboxRunError,
		name: "release-sandbox-workflow-reference",
		execute: Effect.gen(function* () {
			const artifacts = yield* SandboxArtifactStore;
			yield* artifacts.release(artifactOwnerOf(payload, executionId), executionId);
			if (pin.principal.pluginRevision) {
				const references = yield* SandboxWorkflowReferenceRepository;
				yield* references.release(executionId);
			}
		}).pipe(Effect.mapError(rethrowSandboxFailure("infrastructure"))),
	});

	const replayKind = sandboxMetricKind(pin.principal.metadata);
	const originalInstance = yield* WorkflowInstance;
	const scope: WorkflowRunScope = { pin, payload, executionId, instance: originalInstance };

	const replayWorkflow = Effect.fnUntraced(function* () {
		const journal = makeReplayJournal();
		let projected = 0;
		let projectionRebuilds = 0;
		let replayStartedAt = 0;
		const finishReplay = (outcome: SandboxReplayOutcome) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAt) =>
				recordSandboxWorkflowReplayFinished({
					outcome,
					kind: replayKind,
					journalBytes: journal.bytes,
					journalEntries: journal.entries.length,
					durationMs: Math.max(0, finishedAt - replayStartedAt),
				}),
			);
		const failReplay = Effect.fnUntraced(function* (
			replay: SandboxReplayResult,
			step: number,
			error: NonNullable<SandboxExecutionResult["error"]>,
			description: string,
		) {
			yield* finishReplay("failed");
			if (payload.resultMode === "execution") {
				return toSandboxExecutionResult(replay, null, error);
			}
			if (installationUnavailable(error.data)) {
				return yield* new SandboxRunError({ kind: error.kind, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) });
			}
			return yield* sandboxFailure(
				"script-failure",
				`Workflow replay ${step} failed: ${description}`,
			);
		});
		for (let step = 0; journal.entries.length <= SANDBOX_WORKFLOW_MAX_STEPS; step += 1) {
			yield* appendWorkflowJournal(executionId, projected, journal.entries.slice(projected));
			projected = journal.entries.length;
			const replayExecutionId = `${executionId}-replay-${step}`;
			replayStartedAt = yield* Clock.currentTimeMillis;
			const replay = yield* Effect.scoped(
				processReplay({
					lane: payload.lane,
					context: payload.input,
					startedAt: pin.startedAt,
					principal: pin.principal,
					executionId: replayExecutionId,
					workflowExecutionId: executionId,
					journalLength: journal.entries.length,
					...(payload.grants ? { grants: payload.grants } : {}),
				}),
			).pipe(Effect.catchTag("SandboxProjectionMissing", () => Effect.void));
			if (replay === undefined) {
				yield* finishReplay("missing");
				projectionRebuilds += 1;
				if (projectionRebuilds > SANDBOX_WORKFLOW_MAX_PROJECTION_REBUILDS) {
					return yield* sandboxFailure(
						"resource-unavailable",
						`Sandbox workflow projection remained missing after ${SANDBOX_WORKFLOW_MAX_PROJECTION_REBUILDS} consecutive rebuilds`,
					);
				}
				projected = 0;
				continue;
			}
			const dispatcher = yield* SandboxDurableHostDispatcher;
			const cancelPending =
				replay.pendingInline.length === 0
					? Effect.void
					: makeActivity({
							name: `cancel-sandbox-inline-${step}`,
							execute: dispatcher.cancelInline(executionId, replay.pendingInline),
						});
			if (replay.pendingInline.length > 0) {
				yield* Workflow.addFinalizer(() =>
					originalInstance.interrupted ? cancelPending : Effect.void,
				);
			}
			projectionRebuilds = 0;
			yield* Effect.forEach(
				replay.logs,
				(message) =>
					Effect.logDebug(message).pipe(
						Effect.annotateLogs({ replayStep: step, sandboxWorkflowExecutionId: executionId }),
					),
				{ discard: true },
			);
			if (replay.error) {
				yield* cancelPending;
				return yield* failReplay(
					replay,
					step,
					replay.error,
					`${replay.error.phase}: ${replay.error.message}`,
				);
			}
			const observed = yield* observeWorkflowReplay(
				replay.value,
				journal.entries,
				replay.inline,
				pin.principal.pluginRevision,
				pin.principal.metadata,
				step,
			).pipe(Effect.onError(() => cancelPending));
			const pending = yield* validatePendingInline(replay, observed).pipe(
				Effect.onError(() => cancelPending),
			);
			if (journal.entries.length + replay.inline.length > SANDBOX_WORKFLOW_MAX_STEPS) {
				break;
			}
			for (const entry of replay.inline) {
				yield* journal.append(entry.request, entry.value);
			}
			if (observed.state === "failed") {
				return yield* failReplay(
					replay,
					step,
					{ phase: "execute", kind: observed.kind, message: observed.error },
					observed.error,
				);
			}
			if (observed.state === "completed") {
				yield* finishReplay("completed");
				const output =
					replay.harvest && isObjectRecord(observed.output)
						? withHarvestedChunks(observed.output, replay.harvest.chunkHandles)
						: observed.output;
				return payload.resultMode === "execution"
					? toSandboxExecutionResult(replay, output)
					: output;
			}
			yield* finishReplay("pending");
			if (journal.entries.length + observed.requests.length > SANDBOX_WORKFLOW_MAX_STEPS) {
				break;
			}
			const values = yield* Effect.forEach(
				observed.requests,
				(observedRequest) =>
					settleSandboxRequest(scope, observedRequest, pending.get(observedRequest.request.index)),
				{ concurrency: SANDBOX_LIMITS.bridge.concurrentHostCalls },
			);
			for (let index = 0; index < observed.requests.length; index += 1) {
				const observedRequest = observed.requests[index];
				const value = values[index];
				if (!observedRequest || value === undefined) {
					return yield* sandboxFailure(
						"infrastructure",
						"Sandbox workflow durable batch returned incomplete results",
					);
				}
				yield* journal.append(observedRequest.request, value);
			}
		}

		return yield* sandboxFailure(
			"script-failure",
			`Sandbox workflow exceeded the maximum of ${SANDBOX_WORKFLOW_MAX_STEPS} durable steps`,
		);
	});
	return yield* replayWorkflow().pipe(
		Effect.catchTag("SandboxRunError", (error) =>
			payload.resultMode === "execution" && installationUnavailable(error.data)
				? Effect.succeed(toSandboxExecutionResult(
						{ logs: [], value: null, status: "completed", error: null },
						null,
						{ kind: "resource-unavailable", phase: "execute", message: error.message, ...(error.data === undefined ? {} : { data: error.data }) },
					))
				: Effect.fail(error),
		),
		Effect.matchCauseEffect({
			onSuccess: (output) => releaseReference.pipe(Effect.as(output)),
			onFailure: (cause) =>
				Effect.flatMap(WorkflowInstance, (instance) =>
					instance.suspended && Cause.hasInterruptsOnly(cause)
						? Effect.failCause(cause)
						: releaseReference.pipe(Effect.andThen(Effect.failCause(cause))),
				),
		}),
	);
});

export const runSandboxScriptWorkflow = Effect.fn("SandboxScriptWorkflow")(function* (
	payload: SandboxScriptWorkflowPayloadValue,
	executionId: string,
) {
	const receipts = yield* MutationReceipts.make;
	yield* admitWorkflow(
		receipts,
		SandboxScriptWorkflow,
		accountGenerationOf(payload),
		executionId,
	).pipe(Effect.mapError(rethrowSandboxFailure("infrastructure")));
	return yield* runSandboxScriptWorkflowBody(payload, executionId, processPinnedSandbox);
});

export const executeSandboxScriptWorkflow = Effect.fn("executeSandboxScriptWorkflow")(function* (
	payload: SandboxScriptWorkflowPayloadValue,
) {
	const engine = yield* WorkflowEngine;
	const receipts = yield* MutationReceipts.make;
	const value = yield* dispatchAdmittedWorkflow(
		receipts,
		engine,
		SandboxScriptWorkflow,
		accountGenerationOf(payload),
		{ payload, executionId: payload.executionId },
		(admission) => admission.pipe(Effect.mapError(rethrowSandboxFailure("infrastructure"))),
		(execution) => execution,
	);
	return yield* Schema.decodeUnknownEffect(SandboxExecutionResultSchema)(value).pipe(
		Effect.mapError((error) =>
			sandboxFailure(
				"invalid-output",
				`Sandbox execution result is invalid: ${unknownToMessage(error)}`,
			),
		),
	);
});
