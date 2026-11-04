import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationHookIdentity,
	AutomationPolicyPatch,
	AutomationRequestPayload,
	AutomationRun,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";

import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { DatabaseSession } from "#platform/db/session";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import { lifecycleTrigger } from "./command";
import { AutomationPolicyExecutionError, LifecycleExecution } from "./execution";
import { LifecyclePlannedPolicy, LifecyclePlanner } from "./planning";
import { applyLifecyclePolicyPatch, canonicalLifecyclePolicyPatch } from "./policy-patch";

export const PolicyBatchItem = Schema.Struct({
	schemaKey: Schema.String,
	request: AutomationRequestPayload,
	itemIdentity: Schema.NonEmptyString,
});
const State = Schema.Struct({
	...PolicyBatchItem.fields,
	rejected: Schema.NullOr(Schema.String),
	patches: Schema.Array(AutomationPolicyPatch),
	processed: Schema.Array(AutomationHookIdentity),
	error: Schema.NullOr(
		Schema.Struct({
			entityId: Schema.optional(EntityId),
			code: Schema.Literals([
				"invalid-properties",
				"invalid-policy-transform",
				"reference-not-found",
			]),
		}),
	),
});
export const PolicyBatchResult = Schema.Struct({
	items: Schema.Array(State),
	triggerId: Schema.NullOr(AutomationTrigger.fields.id),
	references: Schema.Record(EntityId, AutomationEntityDraft),
});
export type PolicyBatchResult = typeof PolicyBatchResult.Type;

export class PolicyBatchBlocked extends Schema.TaggedError<
	PolicyBatchBlocked,
	{ readonly brand: unique symbol }
>()("PolicyBatchBlocked", { triggerId: AutomationTrigger.fields.id }) {}

const Failure = Schema.Union([DbError, AutomationPolicyExecutionError, PolicyBatchBlocked]);
export const PolicyBatchPayload = Schema.Struct({
	userId: UserId,
	command: DomainLifecycleCommand,
	items: Schema.Array(PolicyBatchItem),
	references: Schema.Record(EntityId, AutomationEntityDraft),
	propertiesSchemas: Schema.Record(Schema.String, AppSchema),
	resource: Schema.Literals(["entity", "event", "relationship"]),
});
export const PolicyBatchWorkflow = Workflow.make("PolicyBatchWorkflow", {
	error: Failure,
	success: PolicyBatchResult,
	payload: PolicyBatchPayload,
	idempotencyKey: ({ command }) => `${command.causation.executionId}:${command.itemIdentity}`,
});

const Plan = Schema.Struct({
	runs: Schema.Array(AutomationRun),
	trigger: Schema.NullOr(AutomationTrigger),
	policies: Schema.Array(LifecyclePlannedPolicy),
});

/** Plans a batch's policies on the caller's transaction; a null trigger means none matched. */
export const planPolicyBatch = Effect.fn("planPolicyBatch")(function* (
	input: typeof PolicyBatchPayload.Type,
) {
	if (input.items.length === 0) {
		return { runs: [], policies: [], trigger: null };
	}
	const planned = yield* (yield* LifecyclePlanner).plan({
		trigger: yield* lifecycleTrigger(input.command, input.userId, {
			operation: "batch",
			category: "request",
			resource: input.resource,
			references: input.references,
			items: input.items.map((item) => item.request),
			itemIdentities: input.items.map((item) => item.itemIdentity),
		}),
	});
	return { runs: planned.runs, trigger: planned.trigger, policies: planned.policies };
});

/** The result of a batch no policy has changed. */
export const unchangedPolicyBatch = (
	input: typeof PolicyBatchPayload.Type,
	triggerId: null | AutomationTrigger["id"],
): PolicyBatchResult => ({
	triggerId,
	references: input.references,
	items: input.items.map((item) => ({
		...item,
		patches: [],
		error: null,
		processed: [],
		rejected: null,
	})),
});

export const runPolicyBatchWorkflow = Effect.fn("PolicyBatchWorkflow")(function* (
	input: typeof PolicyBatchPayload.Type,
) {
	const execution = yield* LifecycleExecution;
	const session = yield* DatabaseSession;
	const plan = yield* makeActivity({
		name: "plan",
		success: Plan,
		error: Failure,
		execute: session
			.transaction(planPolicyBatch(input))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
	});
	if (plan.trigger?.blockedReason) {
		return yield* new PolicyBatchBlocked({ triggerId: plan.trigger.id });
	}
	const triggerId = plan.trigger?.id;
	if (triggerId) {
		yield* Workflow.addFinalizer(() =>
			makeActivity({
				error: DbError,
				success: Schema.Void,
				name: "skip-remaining-policies",
				execute: execution.skipQueuedPolicies({ triggerId }),
			}).pipe(
				Effect.catchCause((cause) => Effect.logError("Policy batch finalization failed", cause)),
			),
		);
	}
	return yield* applyPolicies(input, plan, execution.executeBatchPolicy, (name, execute) =>
		makeActivity({ name, execute, error: Failure, success: PolicyBatchResult }),
	);
});

type PolicyBatchPlan = typeof Plan.Type;
type PolicyBatchFailure = typeof Failure.Type;
type BatchPolicyInput = Parameters<LifecycleExecution["Service"]["executeBatchPolicy"]>[0];
type BatchPolicyOutput = Effect.Success<
	ReturnType<LifecycleExecution["Service"]["executeBatchPolicy"]>
>;

/** Runs a planned batch's policies in order and applies their decisions; `step` makes each application durable. */
const applyPolicies = Effect.fnUntraced(function* <R1, R2>(
	input: typeof PolicyBatchPayload.Type,
	plan: PolicyBatchPlan,
	executePolicy: (
		policy: BatchPolicyInput,
	) => Effect.Effect<BatchPolicyOutput, AutomationPolicyExecutionError, R1>,
	step: (
		name: string,
		execute: Effect.Effect<PolicyBatchResult, PolicyBatchFailure>,
	) => Effect.Effect<PolicyBatchResult, PolicyBatchFailure, R2>,
) {
	const entities = yield* EntitiesRepository;
	let result = unchangedPolicyBatch(input, plan.trigger?.id ?? null);
	const propertiesSchemaOf = (item: typeof PolicyBatchItem.Type) => {
		const schema = input.propertiesSchemas[item.schemaKey];
		return schema === undefined
			? Effect.fail(new DbError({ message: "Policy batch item schema is unavailable" }))
			: Effect.succeed(schema);
	};
	const ordered = [...plan.policies].sort((left, right) => {
		const a = plan.runs.find((run) => run.id === left.runId);
		const b = plan.runs.find((run) => run.id === right.runId);
		return (
			left.position - right.position ||
			(a?.pluginId ?? "").localeCompare(b?.pluginId ?? "") ||
			(a?.hookSlug ?? "").localeCompare(b?.hookSlug ?? "")
		);
	});
	for (const policy of ordered) {
		const output = yield* executePolicy({
			runId: policy.runId,
			acceptedReferences: result.references,
			acceptedBatchPatches: Object.fromEntries(
				result.items.map((item) => [item.itemIdentity, item.patches]),
			),
			activeItemIdentities: result.items
				.filter((item) => item.rejected === null && item.error === null)
				.map((item) => item.itemIdentity),
		});
		const previous = result;
		result = yield* step(
			`apply-${policy.runId}`,
			Effect.gen(function* () {
				const run = plan.runs.find((candidate) => candidate.id === policy.runId);
				if (!run) {
					return yield* new DbError({ message: "Policy batch run is unavailable" });
				}
				const references = { ...previous.references };
				const items = yield* Effect.forEach(previous.items, (item) =>
					Effect.gen(function* () {
						const decision = output.items.find(
							(candidate) => candidate.itemIdentity === item.itemIdentity,
						)?.decision;
						if (!decision || item.rejected !== null || item.error !== null) {
							return item;
						}
						const processed =
							policy.batchFrequency === "once-per-subject"
								? [...item.processed, { hookSlug: run.hookSlug, pluginId: run.pluginId }]
								: item.processed;
						if (decision.action === "reject") {
							return { ...item, processed, rejected: decision.reason };
						}
						if (decision.action === "allow") {
							return { ...item, processed };
						}
						const patched = applyLifecyclePolicyPatch(item.request, decision.patch);
						if (!patched.ok || patched.request.operation === "delete") {
							return { ...item, processed, error: { code: "invalid-policy-transform" as const } };
						}
						const propertiesSchema = yield* propertiesSchemaOf(item);
						const properties = yield* parseAppSchemaProperties({
							kind: "Mutation",
							propertiesSchema,
							properties: patched.request.draft.properties,
							allowedMissingRequiredPaths: Object.keys(propertiesSchema.fields).map((key) => [key]),
						}).pipe(Effect.result);
						if (properties._tag === "Failure") {
							return { ...item, processed, error: { code: "invalid-properties" as const } };
						}
						const decodedRequest = yield* Schema.decodeUnknownEffect(AutomationRequestPayload)({
							...patched.request,
							draft: {
								...patched.request.draft,
								properties: properties.success,
								...(patched.request.resource === "event"
									? {
											sessionEntityId: patched.request.draft.sessionEntityId?.trim()
												? EntityId.make(patched.request.draft.sessionEntityId.trim())
												: null,
										}
									: {}),
							},
						}).pipe(Effect.result);
						if (decodedRequest._tag === "Failure") {
							return { ...item, processed, error: { code: "invalid-policy-transform" as const } };
						}
						const request = decodedRequest.success;
						if (
							request.resource === "event" &&
							request.draft.sessionEntityId !== null &&
							!references[request.draft.sessionEntityId]
						) {
							const reference = yield* entities.getByIdForUser({
								userId: input.userId,
								entityId: request.draft.sessionEntityId,
							});
							if (!reference) {
								return {
									...item,
									processed,
									error: {
										code: "reference-not-found" as const,
										entityId: request.draft.sessionEntityId,
									},
								};
							}
							references[request.draft.sessionEntityId] = yield* Schema.decodeUnknownEffect(
								AutomationEntityDraft,
							)({
								name: reference.name,
								properties: reference.properties,
								providerId: reference.providerId,
								externalId: reference.externalId,
								populatedAt: reference.populatedAt,
								entitySchemaSlug: reference.entitySchemaSlug,
								entitySchemaPluginId: reference.entitySchemaPluginId ?? null,
							}).pipe(Effect.mapError(() => new DbError({ message: "Invalid policy reference" })));
						}
						const patch = canonicalLifecyclePolicyPatch(item.request, request);
						return {
							...item,
							request,
							processed,
							patches: patch ? [...item.patches, patch] : item.patches,
						};
					}),
				);
				return { ...previous, items, references };
			}),
		);
	}
	const previous = result;
	return yield* step(
		"validate-final-drafts",
		Effect.gen(function* () {
			const items = yield* Effect.forEach(previous.items, (item) =>
				Effect.gen(function* () {
					if (
						item.rejected !== null ||
						item.error !== null ||
						item.request.operation === "delete"
					) {
						return item;
					}
					const parsed = yield* parseAppSchemaProperties({
						kind: "Mutation",
						properties: item.request.draft.properties,
						propertiesSchema: yield* propertiesSchemaOf(item),
					}).pipe(Effect.result);
					return parsed._tag === "Failure"
						? { ...item, error: { code: "invalid-properties" as const } }
						: item;
				}),
			);
			return { ...previous, items };
		}),
	);
});

/**
 * Runs a planned batch's policies outside a workflow, for a command whose source write has not begun; a failure
 * leaves the remaining queued policies skipped.
 */
export const runPolicyBatchDirect = Effect.fn("PolicyBatchDirect")(function* (
	input: typeof PolicyBatchPayload.Type,
	plan: PolicyBatchPlan,
) {
	const execution = yield* LifecycleExecution;
	return yield* applyPolicies(
		input,
		plan,
		execution.executeBatchPolicy,
		(_name, execute) => execute,
	).pipe(
		Effect.onError(() =>
			plan.trigger === null
				? Effect.void
				: execution
						.skipQueuedPolicies({ triggerId: plan.trigger.id })
						.pipe(Effect.catchCause((cause) => Effect.logError("Policy batch skip failed", cause))),
		),
	);
});

export const PolicyBatchWorkflowLive = implementWorkflow(
	PolicyBatchWorkflow,
	runPolicyBatchWorkflow,
);
