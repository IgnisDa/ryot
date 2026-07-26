import { DbError, type SandboxFailureKind, type SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationInput,
	AutomationPolicyInput,
	AutomationPolicyOutput,
	AutomationRunAttempt,
	type AutomationFailureKind,
	type AutomationRun,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { SandboxExecutionError } from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxExecutionSubject } from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { eq } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import { pluginRevision } from "#lib/infrastructure/db/schema/tables/core";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxExecutionService } from "#modules/sandbox/service";

import {
	AutomationAttemptRepository,
	automationAttemptIdentity,
	type FinalizeAutomationAttempt,
} from "./attempt-repository";
import { AutomationRunRepository } from "./run-repository";
import {
	AutomationAttemptResult,
	AutomationRunWorkflow,
	type AutomationRunWorkflowPayload,
	type AutomationRunWorkflowResult,
} from "./run-workflow";
import { AutomationTriggerRepository } from "./trigger-repository";

const PreparedAutomationRun = Schema.Struct({
	scriptId: SandboxScriptId,
	subject: SandboxExecutionSubject,
	input: Schema.Union([AutomationInput, AutomationPolicyInput]),
});
type PreparedAutomationRun = typeof PreparedAutomationRun.Type;

class AutomationPreparationError extends Schema.TaggedError<AutomationPreparationError>()(
	"AutomationPreparationError",
	{ kind: Schema.Literals(["missing-artifact", "invalid-input"]) },
) {}

const ClaimedAutomationAttempt = Schema.Struct({
	stage: Schema.Literals(["before", "after"]),
	attempt: Schema.NullOr(AutomationRunAttempt),
});

export const prepareAutomationInvocation = (
	run: AutomationRun,
	trigger: AutomationTrigger,
	payload: AutomationRunWorkflowPayload,
	hookMetadata?: JsonValue,
) =>
	Effect.gen(function* () {
		const invalid = () => new AutomationPreparationError({ kind: "invalid-input" });
		if (!trigger.payload || !run.sandboxScriptId) {
			return yield* new AutomationPreparationError({ kind: "missing-artifact" });
		}
		const source = payload.policyPayload ?? trigger.payload;
		if (
			run.id !== payload.runId ||
			run.triggerId !== trigger.id ||
			(run.stage === "before"
				? payload.attemptNumber !== 1 ||
					source.category !== "request" ||
					trigger.payload.category !== "request" ||
					source.resource !== trigger.payload.resource ||
					source.operation !== trigger.payload.operation
				: payload.policyPayload !== undefined || source.category === "request")
		) {
			return yield* invalid();
		}
		const input = {
			automation: {
				runId: run.id,
				payload: source,
				triggerId: trigger.id,
				hookSlug: run.hookSlug,
				causation: trigger.causation,
				occurredAt: trigger.occurredAt,
				executionUserId: run.executionUserId,
				...(hookMetadata === undefined ? {} : { hookMetadata }),
			},
		};
		if (sandboxContextError(input)) {
			return yield* invalid();
		}
		return yield* Schema.decodeUnknownEffect(PreparedAutomationRun)({
			input,
			scriptId: run.sandboxScriptId,
			subject: {
				runId: run.id,
				stage: run.stage,
				triggerId: trigger.id,
				type: "automation-run",
				pluginId: run.pluginId,
				causation: trigger.causation,
				executionUserId: run.executionUserId,
				pluginRevisionId: run.pluginRevisionId,
				pluginConfigRevisionId: run.pluginConfigRevisionId,
			},
		}).pipe(Effect.mapError(invalid));
	});

export class AutomationRunWorkflowOperations extends Context.Service<
	AutomationRunWorkflowOperations,
	{
		claim: (
			payload: AutomationRunWorkflowPayload,
		) => Effect.Effect<typeof ClaimedAutomationAttempt.Type, DbError>;
		prepare: (
			payload: AutomationRunWorkflowPayload,
		) => Effect.Effect<PreparedAutomationRun, DbError | AutomationPreparationError>;
		runSandbox: (
			input: PreparedAutomationRun & { executionId: string },
		) => Effect.Effect<SandboxExecutionResult, SandboxRunError>;
		finalize: (input: FinalizeAutomationAttempt) => Effect.Effect<AutomationRunAttempt, DbError>;
	}
>()("AutomationRunWorkflowOperations") {}

export const AutomationRunWorkflowOperationsLive = Layer.effect(
	AutomationRunWorkflowOperations,
	Effect.gen(function* () {
		const attempts = yield* AutomationAttemptRepository;
		const runs = yield* AutomationRunRepository;
		const triggers = yield* AutomationTriggerRepository;
		const scripts = yield* SandboxRepository;
		const sandbox = yield* SandboxExecutionService;
		const database = yield* Database;
		return AutomationRunWorkflowOperations.of({
			runSandbox: (input) => sandbox.executeScript(input),
			finalize: (input) =>
				Effect.gen(function* () {
					return yield* attempts.finalizeAttempt(
						input,
						DateTime.toDate(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
					);
				}).pipe(Effect.provideService(Database, database)),
			claim: (payload) =>
				Effect.gen(function* () {
					const result = yield* attempts.claimNextAttempt({
						...payload,
						now: DateTime.toDate(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
					});
					const run = yield* runs.findById(payload.runId);
					if (!run) {
						return yield* new DbError({ message: "Automation run is unavailable" });
					}
					return { stage: run.stage, attempt: result.attempt };
				}).pipe(Effect.provideService(Database, database)),
			prepare: (payload) =>
				Effect.gen(function* () {
					const missing = () => new AutomationPreparationError({ kind: "missing-artifact" });
					const run = yield* runs.findById(payload.runId);
					if (!run?.sandboxScriptId) {
						return yield* missing();
					}
					const trigger = yield* triggers.findById(run.triggerId);
					if (!trigger?.payload) {
						return yield* missing();
					}
					const pin = yield* scripts.getScriptPin(
						run.sandboxScriptId,
						run.pluginId === null
							? undefined
							: {
									id: run.pluginId,
									revisionId: run.pluginRevisionId,
									configRevisionId: run.pluginConfigRevisionId,
								},
					);
					if (
						!pin ||
						pin.contentHash !== run.scriptContentHash ||
						pin.scriptSlug !== run.scriptSlug ||
						pin.metadata.kind !== "automation" ||
						(run.pluginId === null && pin.pluginRevision !== null)
					) {
						return yield* missing();
					}
					let hookMetadata: JsonValue | undefined;
					if (run.pluginId !== null) {
						const [revision] = yield* mapDatabaseErrors(
							database
								.select({ manifest: pluginRevision.manifest })
								.from(pluginRevision)
								.where(eq(pluginRevision.id, run.pluginRevisionId)),
						);
						const hook = revision?.manifest.hooks.find(
							(candidate) => candidate.slug === run.hookSlug,
						);
						if (!hook || hook.scriptSlug !== run.scriptSlug || hook.stage !== run.stage) {
							return yield* missing();
						}
						hookMetadata = hook.metadata;
					}
					return yield* prepareAutomationInvocation(run, trigger, payload, hookMetadata);
				}).pipe(Effect.provideService(Database, database)),
		});
	}),
);

const AUTOMATION_FAILURE_KINDS: Record<SandboxFailureKind, AutomationFailureKind> = {
	timeout: "sandbox-timeout",
	"invalid-input": "invalid-input",
	"invalid-output": "invalid-output",
	"script-failure": "business-failure",
	"missing-artifact": "missing-artifact",
	infrastructure: "sandbox-infrastructure",
	"resource-unavailable": "resource-unavailable",
	"external-uncertain": "external-uncertain-outcome",
};

export const classifyAutomationSandboxError = (
	error: SandboxExecutionError,
): AutomationFailureKind => AUTOMATION_FAILURE_KINDS[error.kind];

const completion = (
	attempt: AutomationRunAttempt,
	policyOutput: AutomationRunWorkflowResult["policyOutput"],
): AutomationRunWorkflowResult => ({
	policyOutput,
	attempt: Schema.decodeSync(AutomationAttemptResult)(attempt),
});

export const runAutomationRunWorkflow = Effect.fn("AutomationRunWorkflow")(function* (
	payload: AutomationRunWorkflowPayload,
	executionId: string,
) {
	const identity = automationAttemptIdentity(payload.runId, payload.attemptNumber);
	if (executionId !== identity.workflowExecutionId) {
		return yield* new DbError({ message: "Automation attempt workflow identity mismatch" });
	}
	const operations = yield* AutomationRunWorkflowOperations;
	const { stage, attempt } = yield* Activity.make({
		error: DbError,
		name: "claim-automation-attempt",
		success: ClaimedAutomationAttempt,
		execute: operations.claim(payload),
	});
	if (attempt === null) {
		return { attempt: null, policyOutput: null };
	}
	if (attempt.status !== "running") {
		const policyOutput =
			stage === "before" && attempt.status === "succeeded"
				? yield* Schema.decodeUnknownEffect(AutomationPolicyOutput)(attempt.returnedValue).pipe(
						Effect.mapError(
							() => new DbError({ message: "Automation policy outcome is unavailable" }),
						),
					)
				: null;
		return completion(attempt, policyOutput);
	}
	const prepared = yield* Activity.make({
		success: PreparedAutomationRun,
		name: "prepare-automation-attempt",
		execute: operations.prepare(payload),
		error: Schema.Union([DbError, AutomationPreparationError]),
	}).pipe(Effect.catchTag("AutomationPreparationError", (error) => Effect.succeed(error)));
	let policyOutput: AutomationRunWorkflowResult["policyOutput"] = null;
	let outcome: FinalizeAutomationAttempt;
	if (prepared instanceof AutomationPreparationError) {
		outcome = {
			...payload,
			logs: [],
			timing: null,
			status: "failed",
			returnedValue: null,
			failureKind: prepared.kind,
			error: {
				code: prepared.kind,
				message: "Automation input or retained artifact is unavailable",
			},
		};
	} else {
		const result = yield* operations
			.runSandbox({ ...prepared, executionId: `${identity.workflowExecutionId}-sandbox` })
			.pipe(
				Effect.catchTag("SandboxRunError", (error) =>
					Effect.succeed({
						logs: [],
						value: null,
						status: "completed" as const,
						error: { kind: error.kind, message: error.message, phase: "execute" as const },
					}),
				),
			);
		let failureKind = result.error ? classifyAutomationSandboxError(result.error) : null;
		const value = yield* Schema.decodeUnknownEffect(JsonValue)(result.value).pipe(
			Effect.orElseSucceed(() => null),
		);
		if (!failureKind && !Schema.is(JsonValue)(result.value)) {
			failureKind = "invalid-output";
		}
		if (
			!failureKind &&
			prepared.subject.type === "automation-run" &&
			prepared.subject.stage === "before"
		) {
			policyOutput = yield* Schema.decodeUnknownEffect(AutomationPolicyOutput)(value).pipe(
				Effect.orElseSucceed(() => null),
			);
			if (!policyOutput) {
				failureKind = "invalid-output";
			}
		}
		outcome = {
			runId: payload.runId,
			returnedValue: value,
			attemptNumber: payload.attemptNumber,
			timing: "timing" in result ? (result.timing ?? null) : null,
			logs: result.logs.map((message) => ({ message, level: "info" as const })),
			error: failureKind
				? { code: failureKind, message: result.error?.message ?? "Invalid automation output" }
				: null,
			...(failureKind
				? { failureKind, status: "failed" }
				: { failureKind: null, status: "succeeded" }),
		};
	}
	const finalized = yield* Activity.make({
		error: DbError,
		success: AutomationRunAttempt,
		name: "finalize-automation-attempt",
		execute: operations.finalize(outcome),
	});
	return completion(finalized, policyOutput);
});

export const AutomationRunWorkflowDefinitionsLive =
	AutomationRunWorkflow.toLayer(runAutomationRunWorkflow);
