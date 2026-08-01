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
import {
	SandboxExecutionSubject,
	SandboxScriptManifest,
	type SandboxExecutionError,
	type SandboxScriptManifest as SandboxScriptManifestType,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { jsonByteLength } from "@ryot-app/sandbox-compiler/limits";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import { applyLifecyclePolicyPatches } from "#lib/domain/lifecycle-policy-patch";
import { pluginRevision } from "#lib/infrastructure/db/schema/tables/core";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxExecutionService } from "#modules/sandbox/service";

import {
	AutomationAttemptRepository,
	automationAttemptIdentity,
	type FinalizeAutomationAttempt,
} from "./attempt-repository";
import { projectAutomationAfterInput, projectAutomationPolicyInput } from "./input-projection";
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
	{ message: Schema.String, kind: Schema.Literals(["missing-artifact", "invalid-input"]) },
) {}

const ClaimedAutomationAttempt = Schema.Struct({
	stage: Schema.Literals(["before", "after"]),
	attempt: Schema.NullOr(AutomationRunAttempt),
});

const workflowMismatch = () =>
	new AutomationPreparationError({
		kind: "invalid-input",
		message: "Automation workflow input does not match the retained run",
	});

const projectionError = (run: AutomationRun, problem: string) =>
	new AutomationPreparationError({
		kind: "invalid-input",
		message: `Automation input projection for script '${run.scriptSlug}' and hook '${run.hookSlug}' ${problem}`,
	});

export const prepareAutomationInvocation = (
	run: AutomationRun,
	trigger: AutomationTrigger,
	payload: AutomationRunWorkflowPayload,
	script: Extract<SandboxScriptManifestType, { kind: "automation" }>,
	hookMetadata?: JsonValue,
) =>
	Effect.gen(function* () {
		if (!trigger.payload) {
			return yield* new AutomationPreparationError({
				kind: "missing-artifact",
				message: "Retained automation trigger payload is unavailable",
			});
		}
		if (!run.sandboxScriptId) {
			return yield* new AutomationPreparationError({
				kind: "missing-artifact",
				message: "Pinned automation script or hook declaration is unavailable",
			});
		}
		if (run.id !== payload.runId || run.triggerId !== trigger.id) {
			return yield* workflowMismatch();
		}
		let projected;
		if (run.stage === "before") {
			if (payload.attemptNumber !== 1 || trigger.payload.category !== "request") {
				return yield* workflowMismatch();
			}
			if (script.automationType !== "policy") {
				return yield* projectionError(run, "has an incompatible policy declaration");
			}
			const patched = applyLifecyclePolicyPatches(trigger.payload, payload.acceptedPatches);
			if (!patched.ok) {
				return yield* workflowMismatch();
			}
			projected = projectAutomationPolicyInput(patched.request, script.inputProjection);
		} else {
			if (payload.acceptedPatches.length !== 0 || trigger.payload.category === "request") {
				return yield* workflowMismatch();
			}
			if (script.automationType !== "automation") {
				return yield* projectionError(run, "has an incompatible automation declaration");
			}
			projected = projectAutomationAfterInput(trigger.payload, script.inputProjection);
		}
		if (!projected) {
			return yield* projectionError(run, "does not declare the retained trigger resource");
		}
		const input = {
			automation: {
				runId: run.id,
				payload: projected,
				triggerId: trigger.id,
				hookSlug: run.hookSlug,
				causation: trigger.causation,
				occurredAt: trigger.occurredAt,
				executionUserId: run.executionUserId,
				...(hookMetadata === undefined ? {} : { hookMetadata }),
			},
		};
		const inputBytes = jsonByteLength(input);
		if (inputBytes === null) {
			return yield* projectionError(run, "produced a non-JSON invocation");
		}
		if (inputBytes > SANDBOX_LIMITS.execution.contextBytes) {
			return yield* new AutomationPreparationError({
				kind: "invalid-input",
				message: `Automation input for hook '${run.hookSlug}' is ${inputBytes} UTF-8 bytes; maximum is ${SANDBOX_LIMITS.execution.contextBytes} bytes`,
			});
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
		}).pipe(
			Effect.mapError(() => projectionError(run, "does not produce a valid invocation schema")),
		);
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
					const missing = () =>
						new AutomationPreparationError({
							kind: "missing-artifact",
							message: "Pinned automation script or hook declaration is unavailable",
						});
					const run = yield* runs.findById(payload.runId);
					if (!run?.sandboxScriptId) {
						return yield* missing();
					}
					const trigger = yield* triggers.findById(run.triggerId);
					if (!trigger?.payload) {
						return yield* new AutomationPreparationError({
							kind: "missing-artifact",
							message: "Retained automation trigger payload is unavailable",
						});
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
					const script = yield* Schema.decodeUnknownEffect(SandboxScriptManifest)(
						pin.metadata,
					).pipe(Effect.mapError(() => projectionError(run, "has an invalid script declaration")));
					if (script.kind !== "automation") {
						return yield* projectionError(run, "has a non-automation script declaration");
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
						const declaration = revision?.manifest.scripts.find(
							(candidate) => candidate.slug === run.scriptSlug,
						);
						if (!hook || hook.scriptSlug !== run.scriptSlug || hook.stage !== run.stage) {
							return yield* missing();
						}
						if (!declaration) {
							return yield* missing();
						}
						const { entry: _entry, ...declaredMetadata } = declaration;
						if (stableStringify(declaredMetadata) !== stableStringify(pin.metadata)) {
							return yield* projectionError(
								run,
								"does not match the exact pinned script declaration",
							);
						}
						hookMetadata = hook.metadata;
					}
					return yield* prepareAutomationInvocation(run, trigger, payload, script, hookMetadata);
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
	const { stage, attempt } = yield* makeActivity({
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
	const prepared = yield* makeActivity({
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
			error: { code: prepared.kind, message: prepared.message },
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
	const finalized = yield* makeActivity({
		error: DbError,
		success: AutomationRunAttempt,
		name: "finalize-automation-attempt",
		execute: operations.finalize(outcome),
	});
	return completion(finalized, policyOutput);
});

export const AutomationRunWorkflowDefinitionsLive = implementWorkflow(
	AutomationRunWorkflow,
	runAutomationRunWorkflow,
);
