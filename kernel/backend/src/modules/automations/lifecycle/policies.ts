import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationHookIdentity,
	type AutomationPolicyBatchOutput,
	type AutomationPolicyOutput,
	AutomationPolicyPatch,
	AutomationRequestPayload,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginBeforeHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationHookSlug,
	AutomationRunId,
	EntityId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import { Message } from "@ryot-app/i18n/message";
import { Context, Effect, Schema } from "effect";

import { definitionText } from "#modules/definitions/text";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { DatabaseSession } from "#platform/db/session";

import { lifecycleTrigger } from "./command";
import { applyLifecyclePolicyPatch, canonicalLifecyclePolicyPatch } from "./policy-patch";

export class AutomationPolicyExecutionError extends Schema.TaggedError<
	AutomationPolicyExecutionError,
	{ readonly brand: unique symbol }
>()("AutomationPolicyExecutionError", {
	runId: AutomationRunId,
	code: Schema.Literal("policy-execution-failed"),
}) {}

/** A policy matched to one request trigger. `runId` is the deterministic identity of that call. */
export const LifecyclePolicy = Schema.Struct({
	pluginId: PluginId,
	runId: AutomationRunId,
	hook: PluginBeforeHook,
	position: Schema.Finite,
	executionUserId: Schema.NullOr(UserId),
	script: Schema.Struct({ slug: Schema.String, id: SandboxScriptId, contentHash: Schema.String }),
	plugin: Schema.Struct({ revisionId: PluginRevisionId, configRevisionId: PluginConfigRevisionId }),
});
export type LifecyclePolicy = typeof LifecyclePolicy.Type;

export type LifecyclePolicyItem = {
	readonly itemIdentity: string;
	readonly request: AutomationRequestPayload;
};

export class LifecyclePolicies extends Context.Service<
	LifecyclePolicies,
	{
		/** The request's matching policies in call order, read on the caller's transaction. */
		match: (trigger: AutomationTrigger) => Effect.Effect<ReadonlyArray<LifecyclePolicy>, DbError>;
		/** Calls the policy once with every item it targets; untargeted items get no decision. */
		run: (input: {
			readonly policy: LifecyclePolicy;
			readonly trigger: AutomationTrigger;
			readonly items: ReadonlyArray<LifecyclePolicyItem>;
			readonly references: Readonly<Record<string, AutomationEntityDraft>>;
		}) => Effect.Effect<AutomationPolicyBatchOutput, AutomationPolicyExecutionError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/lifecycle/policies/LifecyclePolicies") {}

/** Calls a policy for a single-item request, whose item identity is its trigger ID. */
export const runItemPolicy = Effect.fnUntraced(function* (
	policies: LifecyclePolicies["Service"],
	input: {
		readonly policy: LifecyclePolicy;
		readonly trigger: AutomationTrigger;
		readonly request: AutomationRequestPayload;
	},
): Effect.fn.Return<AutomationPolicyOutput, AutomationPolicyExecutionError> {
	const output = yield* policies.run({
		references: {},
		policy: input.policy,
		trigger: input.trigger,
		items: [{ request: input.request, itemIdentity: input.trigger.id }],
	});
	return (
		output.items.find((item) => item.itemIdentity === input.trigger.id)?.decision ??
		(yield* new AutomationPolicyExecutionError({
			runId: input.policy.runId,
			code: "policy-execution-failed",
		}))
	);
});

export const PolicyBatchItem = Schema.Struct({
	schemaKey: Schema.String,
	request: AutomationRequestPayload,
	itemIdentity: Schema.NonEmptyString,
});
const State = Schema.Struct({
	...PolicyBatchItem.fields,
	rejected: Schema.NullOr(Message),
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
	references: Schema.Record(EntityId, AutomationEntityDraft),
});
export type PolicyBatchResult = typeof PolicyBatchResult.Type;

const PolicyBatchPayload = Schema.Struct({
	userId: UserId,
	command: DomainLifecycleCommand,
	items: Schema.Array(PolicyBatchItem),
	references: Schema.Record(EntityId, AutomationEntityDraft),
	propertiesSchemas: Schema.Record(Schema.String, AppSchema),
	resource: Schema.Literals(["entity", "event", "relationship"]),
});
type PolicyBatchPayload = typeof PolicyBatchPayload.Type;

type MatchedPolicyBatch = {
	readonly trigger: AutomationTrigger;
	readonly policies: ReadonlyArray<LifecyclePolicy>;
};

/** Matches a batch's policies on the caller's transaction; null means none matched. */
export const matchPolicyBatch = Effect.fn("matchPolicyBatch")(function* (
	input: PolicyBatchPayload,
): Effect.fn.Return<null | MatchedPolicyBatch, DbError, LifecyclePolicies> {
	if (input.items.length === 0) {
		return null;
	}
	const trigger = yield* lifecycleTrigger(input.command, input.userId, {
		operation: "batch",
		category: "request",
		resource: input.resource,
		references: input.references,
		items: input.items.map((item) => item.request),
		itemIdentities: input.items.map((item) => item.itemIdentity),
	});
	const policies = yield* (yield* LifecyclePolicies).match(trigger);
	return policies.length === 0 ? null : { trigger, policies };
});

export const unchangedPolicyBatch = (input: PolicyBatchPayload): PolicyBatchResult => ({
	references: input.references,
	items: input.items.map((item) => ({
		...item,
		patches: [],
		error: null,
		processed: [],
		rejected: null,
	})),
});

/** Calls each matched policy in order with the items earlier policies left active. */
export const applyPolicyBatch = Effect.fn("applyPolicyBatch")(function* (
	input: PolicyBatchPayload,
	matched: null | MatchedPolicyBatch,
) {
	const policies = yield* LifecyclePolicies;
	const entities = yield* EntitiesRepository;
	let result = unchangedPolicyBatch(input);
	const propertiesSchemaOf = (item: typeof PolicyBatchItem.Type) => {
		const schema = input.propertiesSchemas[item.schemaKey];
		return schema === undefined
			? Effect.fail(new DbError({ message: "Policy batch item schema is unavailable" }))
			: Effect.succeed(schema);
	};
	const calls =
		matched === null
			? []
			: matched.policies.map((policy) => ({ policy, trigger: matched.trigger }));
	for (const { policy, trigger } of calls) {
		const output = yield* policies.run({
			policy,
			trigger,
			references: result.references,
			items: result.items.flatMap((item) =>
				item.rejected === null && item.error === null
					? [{ request: item.request, itemIdentity: item.itemIdentity }]
					: [],
			),
		});
		const previous = result;
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
					policy.hook.batchFrequency === "once-per-subject"
						? [
								...item.processed,
								{ pluginId: policy.pluginId, hookSlug: AutomationHookSlug.make(policy.hook.slug) },
							]
						: item.processed;
				if (decision.action === "reject") {
					return { ...item, processed, rejected: definitionText(policy.pluginId, decision.reason) };
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
		result = { items, references };
	}
	const items = yield* Effect.forEach(result.items, (item) =>
		Effect.gen(function* () {
			if (item.rejected !== null || item.error !== null || item.request.operation === "delete") {
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
	return { ...result, items };
});

/** Matches a batch's policies in their own transaction and calls them, for a caller holding none. */
export const runPolicyBatch = Effect.fn("runPolicyBatch")(function* (input: PolicyBatchPayload) {
	const matched = yield* (yield* DatabaseSession)
		.transaction(matchPolicyBatch(input))
		.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
	return yield* applyPolicyBatch(input, matched);
});
