import { DbError, type SandboxFailureKind } from "@ryot-app/contract/errors";
import {
	AutomationAfterPayload,
	type AutomationFailureKind,
	AutomationInput,
	type AutomationRun,
	AutomationRunAttempt,
	type AutomationTrigger,
	ExecutionLane,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { type ChangeSet, ChangesOutput } from "@ryot-app/contract/modules/changes/change-set";
import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import { StampedSandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import {
	SandboxExecutionSubject,
	SandboxScriptManifest,
	type SandboxScriptManifest as SandboxScriptManifestType,
} from "@ryot-app/contract/modules/scripts/schemas";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import { automationRunSubject } from "#modules/automations/lifecycle/command";
import { AccountAdmission } from "#modules/mutations/account-admission";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { type ScriptCallResult, ScriptCalls } from "#modules/scripts/executions/calls";
import type { StampedSandboxExecutionError } from "#modules/scripts/executions/result";
import {
	ScriptChanges,
	scriptChangesFailure,
	type ScriptChangesRejected,
} from "#modules/scripts/executions/script-changes";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { registerJobHandler } from "#platform/jobs/worker";
import { pluginRevision } from "#schema/tables/core";

import {
	automationAttemptIdentity,
	AutomationAttemptRepository,
	type FinalizeAutomationAttempt,
} from "./attempt-repository";
import { projectAutomationAfterInput } from "./input-projection";
import { automationPayloadPluginId } from "./planner-resolver";
import { AutomationRunJob, type AutomationRunPayload } from "./run-job";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const PreparedAutomationRun = Schema.Struct({
	lane: ExecutionLane,
	input: AutomationInput,
	scriptId: SandboxScriptId,
	subject: SandboxExecutionSubject,
});
/** A prepared run with the exact principal its changes commit under. */
export type PreparedAutomationAttempt = PreparedAutomationRun & {
	readonly principal: ScriptExecutionPrincipal;
};

/** The changes a succeeded after hook returned, committed with its attempt's outcome. */
export type AutomationAttemptChanges = {
	readonly changes: ChangeSet;
	readonly prepared: PreparedAutomationAttempt;
};

type PreparedAutomationRun = typeof PreparedAutomationRun.Type;

class AutomationPreparationError extends Schema.TaggedError<
	AutomationPreparationError,
	{ readonly brand: unique symbol }
>()("AutomationPreparationError", {
	message: Schema.String,
	data: Schema.optional(StampedSandboxBoundaryReason),
	kind: Schema.Literals(["missing-artifact", "invalid-input", "business-failure"]),
}) {}

const ClaimedAutomationAttempt = Schema.Struct({
	claimed: Schema.Boolean,
	attempt: Schema.NullOr(AutomationRunAttempt),
});

const inputMismatch = () =>
	new AutomationPreparationError({
		kind: "invalid-input",
		message: "Automation input does not match the retained run",
	});

const projectionError = (run: AutomationRun, problem: string) =>
	new AutomationPreparationError({
		kind: "invalid-input",
		message: `Automation input projection for script '${run.scriptSlug}' and hook '${run.hookSlug}' ${problem}`,
	});

export const prepareAutomationInvocation = (
	run: AutomationRun,
	trigger: AutomationTrigger,
	payload: AutomationRunPayload,
	script: Extract<SandboxScriptManifestType, { kind: "automation" }>,
	accountUserId: null | UserId,
	hookMetadata?: JsonValue,
	hookTargets: PluginHook["targets"] = [],
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
			return yield* inputMismatch();
		}
		if (script.automationType !== "automation") {
			return yield* projectionError(run, "has an incompatible automation declaration");
		}
		const owners = new Set(
			hookTargets.length === 0
				? [run.pluginId]
				: hookTargets.map((target) => {
						const owner = "owner" in target ? target.owner : definitionOwner(run.pluginId);
						return definitionOwnerPluginId(owner);
					}),
		);
		const payloadForOwner =
			trigger.payload.operation === "batch"
				? yield* Schema.decodeUnknownEffect(AutomationAfterPayload)({
						...trigger.payload,
						items: trigger.payload.items.filter((item) => {
							const pluginId = automationPayloadPluginId(item);
							return pluginId !== undefined && owners.has(pluginId);
						}),
					}).pipe(
						Effect.mapError(() =>
							projectionError(run, "has no retained batch evidence for its declared owners"),
						),
					)
				: trigger.payload;
		const projected = projectAutomationAfterInput(payloadForOwner, script.inputProjection);
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
		return yield* Schema.decodeUnknownEffect(PreparedAutomationRun)({
			input,
			lane: "background",
			scriptId: run.sandboxScriptId,
			subject: automationRunSubject(
				{ trigger, accountUserId, runId: run.id, executionUserId: run.executionUserId },
				{
					pluginId: run.pluginId,
					pluginRevisionId: run.pluginRevisionId,
					pluginConfigRevisionId: run.pluginConfigRevisionId,
				},
			),
		}).pipe(
			Effect.mapError(() => projectionError(run, "does not produce a valid invocation schema")),
		);
	});

export class AutomationRunOperations extends Context.Service<
	AutomationRunOperations,
	{
		claim: (
			payload: AutomationRunPayload,
		) => Effect.Effect<typeof ClaimedAutomationAttempt.Type, DbError>;
		runSandbox: (
			input: { executionId: string } & PreparedAutomationAttempt,
		) => Effect.Effect<ScriptCallResult<ChangesOutput>>;
		prepare: (
			payload: AutomationRunPayload,
		) => Effect.Effect<PreparedAutomationAttempt, DbError | AutomationPreparationError>;
		finalize: (
			input: FinalizeAutomationAttempt,
			changes?: AutomationAttemptChanges,
		) => Effect.Effect<AutomationRunAttempt, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/run-job-live/AutomationRunOperations") {}

const missing = () =>
	new AutomationPreparationError({
		kind: "missing-artifact",
		message: "Pinned automation script or hook declaration is unavailable",
	});

export const AutomationRunOperationsLive = Layer.effect(
	AutomationRunOperations,
	Effect.gen(function* () {
		const attempts = yield* AutomationAttemptRepository;
		const runs = yield* AutomationRunRepository;
		const triggers = yield* AutomationTriggerRepository;
		const scripts = yield* SandboxRepository;
		const calls = yield* ScriptCalls;
		const session = yield* DatabaseSession;
		const admission = yield* AccountAdmission.make;
		const changes = yield* ScriptChanges;
		return AutomationRunOperations.of({
			runSandbox: ({ lane, input, principal, executionId }) =>
				calls.run({ lane, input, principal, executionId }, ChangesOutput),
			claim: (payload) =>
				Effect.gen(function* () {
					const { attempt, claimed } = yield* attempts.claimNextAttempt({
						...payload,
						now: DateTime.toDate(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
					});
					return { attempt, claimed };
				}),
			finalize: (input, written) =>
				Effect.gen(function* () {
					const now = DateTime.toDate(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
					if (written === undefined) {
						return yield* attempts.finalizeAttempt(input, now);
					}
					const { prepared } = written;
					const { automation } = prepared.input;
					return yield* changes
						.commit({
							lane: prepared.lane,
							changes: written.changes,
							principal: prepared.principal,
							occurredAt: automation.occurredAt,
							executionId: automationAttemptIdentity(input.runId, input.attemptNumber).executionId,
							...("population" in automation.payload && automation.payload.population !== undefined
								? { population: automation.payload.population }
								: {}),
							receipt: {
								record: () => attempts.finalizeAttemptWithin(input, now),
								load: attempts.settledAttemptWithin(input.runId, input.attemptNumber),
							},
						})
						.pipe(
							Effect.catchTag("ScriptChangesRejected", (error) =>
								attempts.finalizeAttempt(rejectedChangesOutcome(input, error), now),
							),
						);
				}),
			prepare: (payload) =>
				session
					.transaction(
						Effect.gen(function* () {
							const initial = yield* runs.findById(payload.runId);
							if (!initial) {
								return yield* missing();
							}
							const accountUserId =
								initial.executionUserId === null
									? null
									: yield* admission.currentAccount(initial.executionUserId);
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
							const subject = automationRunSubject(
								{ trigger, accountUserId, runId: run.id, executionUserId: run.executionUserId },
								run.pluginId === null
									? { pluginId: null, pluginRevisionId: null, pluginConfigRevisionId: null }
									: {
											pluginId: run.pluginId,
											pluginRevisionId: run.pluginRevisionId,
											pluginConfigRevisionId: run.pluginConfigRevisionId,
										},
							);
							const pin = yield* scripts
								.pinnedPrincipal(
									run.sandboxScriptId,
									subject,
									run.pluginId === null
										? {}
										: {
												expectedRevision: {
													id: run.pluginId,
													revisionId: run.pluginRevisionId,
													configRevisionId: run.pluginConfigRevisionId,
												},
											},
								)
								.pipe(
									Effect.catchTag(
										"SandboxRunError",
										(error) =>
											new AutomationPreparationError({
												message: error.message,
												kind: error.data ? "business-failure" : "missing-artifact",
												...(error.data === undefined ? {} : { data: error.data }),
											}),
									),
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
							).pipe(
								Effect.mapError(() => projectionError(run, "has an invalid script declaration")),
							);
							if (script.kind !== "automation") {
								return yield* projectionError(run, "has a non-automation script declaration");
							}
							let hookMetadata: JsonValue | undefined;
							let hookTargets: PluginHook["targets"] = [];
							if (run.pluginId !== null) {
								const [revision] = yield* session.run((database) =>
									database
										.select({ hooks: pluginRevision.hooks, scripts: pluginRevision.scripts })
										.from(pluginRevision)
										.where(eq(pluginRevision.id, run.pluginRevisionId)),
								);
								const hook = revision?.hooks.find((candidate) => candidate.slug === run.hookSlug);
								const declaration = revision?.scripts.find(
									(candidate) => candidate.slug === run.scriptSlug,
								);
								if (!hook || hook.scriptSlug !== run.scriptSlug || hook.stage !== "after") {
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
								hookTargets = hook.targets;
							}
							const prepared = yield* prepareAutomationInvocation(
								run,
								trigger,
								payload,
								script,
								accountUserId,
								hookMetadata,
								hookTargets,
							);
							return { ...prepared, principal: pin };
						}),
					)
					.pipe(
						Effect.catchTag(
							"DatabaseSessionStateError",
							() => new DbError({ message: "Automation preparation requires a root transaction" }),
						),
					),
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
	error: StampedSandboxExecutionError,
): AutomationFailureKind => AUTOMATION_FAILURE_KINDS[error.kind];

const rejectedChangesOutcome = (
	input: FinalizeAutomationAttempt,
	error: ScriptChangesRejected,
): FinalizeAutomationAttempt => {
	const failure = scriptChangesFailure(error);
	return {
		...input,
		status: "failed",
		failureKind: AUTOMATION_FAILURE_KINDS[failure.kind],
		error: { code: failure.code, message: failure.message },
	};
};

const attemptOutcome = Effect.fnUntraced(function* (
	payload: AutomationRunPayload,
	prepared: PreparedAutomationAttempt | AutomationPreparationError,
	runSandbox: (
		prepared: PreparedAutomationAttempt,
	) => Effect.Effect<ScriptCallResult<ChangesOutput>>,
) {
	if (prepared instanceof AutomationPreparationError) {
		return {
			changes: undefined,
			outcome: {
				...payload,
				logs: [],
				timing: null,
				status: "failed",
				returnedValue: null,
				failureKind: prepared.kind,
				error: { message: prepared.message, code: prepared.data?.code ?? prepared.kind },
			} satisfies FinalizeAutomationAttempt,
		};
	}
	const result = yield* runSandbox(prepared);
	const common = {
		runId: payload.runId,
		timing: result.timing ?? null,
		attemptNumber: payload.attemptNumber,
		returnedValue: Schema.is(JsonValue)(result.value) ? result.value : null,
		logs: result.logs.map((message) => ({ message, level: "info" as const })),
	};
	if (result.error) {
		const failureKind = classifyAutomationSandboxError(result.error);
		return {
			changes: undefined,
			outcome: {
				...common,
				failureKind,
				status: "failed",
				error: { message: result.error.message, code: result.error.data?.code ?? failureKind },
			} satisfies FinalizeAutomationAttempt,
		};
	}
	return {
		changes: result.output.changes,
		outcome: {
			...common,
			error: null,
			failureKind: null,
			status: "succeeded",
		} satisfies FinalizeAutomationAttempt,
	};
});

/**
 * Runs one attempt from its claim to its finalization. A retry resumes the same attempt: its claim stays
 * running, and its finalization commits its changes at most once.
 */
export const runAutomationAttempt = Effect.fn("AutomationRunJob")(function* (
	payload: AutomationRunPayload,
) {
	const identity = automationAttemptIdentity(payload.runId, payload.attemptNumber);
	const operations = yield* AutomationRunOperations;
	const { attempt } = yield* operations.claim(payload);
	if (attempt?.status !== "running") {
		return;
	}
	const prepared = yield* operations
		.prepare(payload)
		.pipe(Effect.catchTag("AutomationPreparationError", (error) => Effect.succeed(error)));
	const { outcome, changes } = yield* attemptOutcome(payload, prepared, (input) =>
		operations.runSandbox({ ...input, executionId: `${identity.executionId}-sandbox` }),
	);
	yield* operations.finalize(
		outcome,
		prepared instanceof AutomationPreparationError || changes === undefined
			? undefined
			: { changes, prepared },
	);
});

export const AutomationRunJobLive = registerJobHandler(AutomationRunJob, runAutomationAttempt);
