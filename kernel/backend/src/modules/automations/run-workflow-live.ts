import { DbError, type SandboxFailureKind, type SandboxRunError } from "@ryot-app/contract/errors";
import {
	type AutomationPolicyReference,
	AutomationInput,
	AutomationAfterPayload,
	AutomationEntityDraft,
	AutomationPolicyBatchInput,
	AutomationRunAttempt,
	ExecutionLane,
	type AutomationFailureKind,
	type AutomationRun,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import {
	SandboxExecutionSubject,
	SandboxScriptManifest,
	type SandboxExecutionError,
	type SandboxScriptManifest as SandboxScriptManifestType,
} from "@ryot-app/contract/modules/scripts/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { SandboxScriptId, EntityId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { jsonByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { SANDBOX_LIMITS } from "@ryot-app/sandbox/protocol/limits";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import { automationRunLane } from "#modules/automations/lifecycle/command";
import { applyLifecyclePolicyPatches } from "#modules/automations/lifecycle/policy-patch";
import { EntitiesRepository } from "#modules/entities/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";
import { pluginRevision } from "#schema/tables/core";

import {
	AutomationAttemptRepository,
	automationAttemptIdentity,
	type FinalizeAutomationAttempt,
} from "./attempt-repository";
import { projectAutomationAfterInput, projectAutomationPolicyInput } from "./input-projection";
import { automationPayloadPluginId, matchesTarget } from "./planner-resolver";
import { AutomationRunRepository } from "./run-repository";
import {
	AutomationAttemptResult,
	AutomationPolicyRunOutput,
	AutomationRunWorkflow,
	type AutomationRunWorkflowPayload,
	type AutomationRunWorkflowResult,
	settledAutomationRunResult,
} from "./run-workflow";
import { AutomationTriggerRepository } from "./trigger-repository";

const PreparedAutomationRun = Schema.Struct({
	lane: ExecutionLane,
	scriptId: SandboxScriptId,
	subject: SandboxExecutionSubject,
	policyItemIdentity: Schema.NullOr(Schema.String),
	input: Schema.Union([AutomationInput, AutomationPolicyBatchInput]),
});
type PreparedAutomationRun = typeof PreparedAutomationRun.Type;

class AutomationPreparationError extends Schema.TaggedError<
	AutomationPreparationError,
	{ readonly brand: unique symbol }
>()("AutomationPreparationError", {
	message: Schema.String,
	data: Schema.optional(SandboxBoundaryReason),
	kind: Schema.Literals(["missing-artifact", "invalid-input", "business-failure"]),
}) {}

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
	accountGeneration: AccountGeneration | null,
	hookMetadata?: JsonValue,
	hookTargets: PluginHook["targets"] = [],
	batchFrequency: "item" | "once-per-subject" = "item",
	referenceDrafts: Readonly<Record<string, AutomationEntityDraft>> = {},
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
		let policyItemIdentity: string | null = null;
		if (run.stage === "before") {
			if (payload.attemptNumber !== 1 || trigger.payload.category !== "request") {
				return yield* workflowMismatch();
			}
			if (script.automationType !== "policy") {
				return yield* projectionError(run, "has an incompatible policy declaration");
			}
			const source = trigger.payload;
			const requests =
				source.operation === "batch"
					? source.items.map((request, index) => ({
							request,
							itemIdentity: source.itemIdentities[index],
							patches: payload.acceptedBatchPatches?.[source.itemIdentities[index] ?? ""] ?? [],
						}))
					: [{ request: source, itemIdentity: trigger.id, patches: payload.acceptedPatches }];
			const items: Array<AutomationPolicyBatchInput["items"][number]> = [];
			const references: Record<string, typeof AutomationPolicyReference.Type> = {};
			const subjects = new Set<string>();
			for (const item of requests) {
				if (!item.itemIdentity) {
					return yield* workflowMismatch();
				}
				if (
					payload.activeItemIdentities &&
					!payload.activeItemIdentities.includes(item.itemIdentity)
				) {
					continue;
				}
				if (
					hookTargets.length > 0 &&
					!hookTargets.some((target) =>
						matchesTarget(definitionOwner(run.pluginId), target, {
							...trigger,
							payload: item.request,
						}),
					)
				) {
					continue;
				}
				if (item.request.resource === "event" && batchFrequency === "once-per-subject") {
					const subject = item.request.draft.entityId;
					if (
						subjects.has(subject) ||
						item.request.excludedOncePerSubjectPolicies?.some(
							(identity) =>
								identity.pluginId === run.pluginId && identity.hookSlug === run.hookSlug,
						)
					) {
						continue;
					}
					subjects.add(subject);
				}
				const patched = applyLifecyclePolicyPatches(item.request, item.patches);
				if (!patched.ok) {
					return yield* workflowMismatch();
				}
				const request = projectAutomationPolicyInput(patched.request, script.inputProjection);
				if (!request) {
					return yield* projectionError(run, "does not declare the retained request resource");
				}
				const referenceProjection = script.inputProjection[request.resource];
				if (request.resource === "event" && referenceProjection) {
					const sourceReferences =
						payload.acceptedReferences ??
						(source.operation === "batch" ? source.references : referenceDrafts);
					for (const [id, names] of [
						[request.draft.entityId, referenceProjection.entityProperties ?? []],
						[request.draft.sessionEntityId, referenceProjection.sessionEntityProperties ?? []],
					] as const) {
						const reference = id === null ? undefined : sourceReferences[id];
						if (reference && id !== null) {
							references[id] = {
								entitySchemaSlug: reference.entitySchemaSlug,
								entitySchemaPluginId: reference.entitySchemaPluginId,
								properties: {
									...references[id]?.properties,
									...Object.fromEntries(
										names.flatMap((name) => {
											const value = reference.properties[name];
											return value === undefined ? [] : [[name, value]];
										}),
									),
								},
							};
						}
					}
				}
				items.push({ payload: request, itemIdentity: item.itemIdentity });
			}
			projected = {
				items,
				automation: {
					references,
					runId: run.id,
					triggerId: trigger.id,
					hookSlug: run.hookSlug,
					causation: trigger.causation,
					occurredAt: trigger.occurredAt,
					executionUserId: run.executionUserId,
					...(hookMetadata === undefined ? {} : { hookMetadata }),
				},
			};
			policyItemIdentity = source.operation === "batch" ? null : trigger.id;
		} else {
			if (payload.acceptedPatches.length !== 0 || trigger.payload.category === "request") {
				return yield* workflowMismatch();
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
			projected = projectAutomationAfterInput(payloadForOwner, script.inputProjection);
		}
		if (!projected) {
			return yield* projectionError(run, "does not declare the retained trigger resource");
		}
		const input =
			run.stage === "before"
				? projected
				: {
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
			policyItemIdentity,
			scriptId: run.sandboxScriptId,
			lane: automationRunLane({ delivery: run.delivery, causation: trigger.causation }),
			subject: {
				runId: run.id,
				stage: run.stage,
				accountGeneration,
				triggerId: trigger.id,
				delivery: run.delivery,
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

const missing = () =>
	new AutomationPreparationError({
		kind: "missing-artifact",
		message: "Pinned automation script or hook declaration is unavailable",
	});

export const AutomationRunWorkflowOperationsLive = Layer.effect(
	AutomationRunWorkflowOperations,
	Effect.gen(function* () {
		const attempts = yield* AutomationAttemptRepository;
		const entities = yield* EntitiesRepository;
		const runs = yield* AutomationRunRepository;
		const triggers = yield* AutomationTriggerRepository;
		const scripts = yield* SandboxRepository;
		const sandbox = yield* ScriptExecutionService;
		const session = yield* DatabaseSession;
		const receipts = yield* MutationReceipts.make;
		return AutomationRunWorkflowOperations.of({
			runSandbox: (input) => sandbox.executeScript(input),
			finalize: (input) =>
				Effect.gen(function* () {
					return yield* attempts.finalizeAttempt(
						input,
						DateTime.toDate(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
					);
				}),
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
				}),
			prepare: (payload) =>
				session
					.transaction(
						Effect.gen(function* () {
							const initial = yield* runs.findById(payload.runId);
							if (!initial) {
								return yield* missing();
							}
							const accountGeneration =
								initial.executionUserId === null
									? null
									: yield* receipts.currentAccount(initial.executionUserId);
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
							const pin = yield* scripts
								.getScriptPin(
									run.sandboxScriptId,
									run.pluginId === null
										? undefined
										: {
												id: run.pluginId,
												revisionId: run.pluginRevisionId,
												configRevisionId: run.pluginConfigRevisionId,
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
							let batchFrequency: "item" | "once-per-subject" = "item";
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
								hookTargets = hook.targets;
								batchFrequency = hook.stage === "before" ? (hook.batchFrequency ?? "item") : "item";
							}
							let referenceDrafts: Readonly<Record<string, AutomationEntityDraft>> = {};
							if (
								trigger.payload.category === "request" &&
								trigger.payload.operation !== "batch" &&
								trigger.payload.resource === "event" &&
								run.executionUserId !== null
							) {
								const patched = applyLifecyclePolicyPatches(
									trigger.payload,
									payload.acceptedPatches,
								);
								if (!patched.ok || patched.request.resource !== "event") {
									return yield* workflowMismatch();
								}
								const draft = patched.request.draft;
								const references = yield* entities.getByIdsForUser({
									userId: run.executionUserId,
									entityIds: [
										draft.entityId,
										...(draft.sessionEntityId === null ? [] : [draft.sessionEntityId]),
									],
								});
								referenceDrafts = yield* Schema.decodeUnknownEffect(
									Schema.Record(EntityId, AutomationEntityDraft),
								)(
									Object.fromEntries(
										[...references].map(([id, reference]) => [
											id,
											{
												name: reference.name,
												properties: reference.properties,
												providerId: reference.providerId,
												externalId: reference.externalId,
												populatedAt: reference.populatedAt,
												entitySchemaSlug: reference.entitySchemaSlug,
												entitySchemaPluginId: reference.entitySchemaPluginId,
											},
										]),
									),
								).pipe(
									Effect.mapError(() => new DbError({ message: "Invalid policy references" })),
								);
							}
							return yield* prepareAutomationInvocation(
								run,
								trigger,
								payload,
								script,
								accountGeneration,
								hookMetadata,
								hookTargets,
								batchFrequency,
								referenceDrafts,
							);
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
		return yield* settledAutomationRunResult(stage, attempt);
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
			error: { message: prepared.message, code: prepared.data?.code ?? prepared.kind },
		};
	} else {
		const result =
			"items" in prepared.input && prepared.input.items.length === 0
				? { logs: [], error: null, value: { items: [] }, status: "completed" as const }
				: yield* operations
						.runSandbox({ ...prepared, executionId: `${identity.workflowExecutionId}-sandbox` })
						.pipe(
							Effect.catchTag("SandboxRunError", (error) =>
								Effect.succeed({
									logs: [],
									value: null,
									status: "completed" as const,
									error: {
										kind: error.kind,
										message: error.message,
										phase: "execute" as const,
										...(error.data === undefined ? {} : { data: error.data }),
									},
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
			const decoded = yield* Schema.decodeUnknownEffect(AutomationPolicyRunOutput)(value).pipe(
				Effect.orElseSucceed(() => null),
			);
			if (decoded && "items" in decoded && "items" in prepared.input) {
				const expected = prepared.input.items.map((item) => item.itemIdentity);
				const actual = decoded.items.map((item) => item.itemIdentity);
				if (
					actual.length === expected.length &&
					new Set(actual).size === actual.length &&
					actual.every((key) => expected.includes(key))
				) {
					policyOutput =
						prepared.policyItemIdentity === null
							? decoded
							: (decoded.items.find((item) => item.itemIdentity === prepared.policyItemIdentity)
									?.decision ?? null);
				}
			}
			if (!policyOutput) {
				failureKind = "invalid-output";
			}
		}
		const returnedValue =
			policyOutput === null
				? value
				: yield* Schema.encodeEffect(Schema.toCodecJson(AutomationPolicyRunOutput))(
						policyOutput,
					).pipe(Effect.mapError(() => new DbError({ message: "Invalid policy result" })));
		outcome = {
			returnedValue,
			runId: payload.runId,
			attemptNumber: payload.attemptNumber,
			timing: "timing" in result ? (result.timing ?? null) : null,
			logs: result.logs.map((message) => ({ message, level: "info" as const })),
			error: failureKind
				? {
						code: result.error?.data?.code ?? failureKind,
						message: result.error?.message ?? "Invalid automation output",
					}
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
