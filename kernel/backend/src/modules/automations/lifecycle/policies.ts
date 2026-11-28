import type { DbError } from "@ryot-app/contract/errors";
import { SandboxFailureKind } from "@ryot-app/contract/errors";
import {
	type AutomationCausation,
	type AutomationEntityDraft,
	type AutomationPolicyBatchOutput,
	type AutomationPolicyPatch,
	AutomationRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type PolicyFailureReason,
	PolicyRejected,
	PolicyUnavailable,
} from "@ryot-app/contract/modules/changes/policies";
import { PluginBeforeHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntityId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema, PropertyValidationError } from "@ryot-app/contract/schema/property-schema";
import { parseAppSchemaProperties } from "@ryot-app/contract/schema/property-values";
import type { Message } from "@ryot-app/i18n/message";
import { Context, Effect, Schema } from "effect";

import { definitionText } from "#modules/definitions/text";
import { automationEntityDrafts } from "#modules/entities/automation-drafts";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import type { WriteTransaction } from "#platform/db/write-transaction";

import { lifecycleChunks } from "./batch";
import { applyLifecyclePolicyPatch, canonicalLifecyclePolicyPatch } from "./policy-patch";

/** A policy that did not decide its items, with the sandbox failure kind that stopped it. */
export class AutomationPolicyExecutionError extends Schema.TaggedError<
	AutomationPolicyExecutionError,
	{ readonly brand: unique symbol }
>()("AutomationPolicyExecutionError", { kind: SandboxFailureKind }) {}

const isTransientKind = Schema.is(
	Schema.Literals(["resource-unavailable", "timeout", "infrastructure"]),
);

/**
 * The writes one policy call decides, held in memory: a request stores no trigger, and its policies
 * store no runs.
 */
export type PolicyRequest = {
	readonly resource: PolicyResource;
	readonly scopeUserId: null | UserId;
	readonly causation: AutomationCausation;
	readonly occurredAt: DomainLifecycleCommand["occurredAt"];
	readonly references: Readonly<Record<string, AutomationEntityDraft>>;
	readonly items: ReadonlyArray<{
		readonly itemIdentity: string;
		readonly request: AutomationRequestPayload;
	}>;
};

type PolicyResource = "event" | "entity" | "relationship";

/** A policy matched to a request, in call order. */
export const LifecyclePolicy = Schema.Struct({
	pluginId: PluginId,
	hook: PluginBeforeHook,
	position: Schema.Finite,
	executionUserId: Schema.NullOr(UserId),
	script: Schema.Struct({ slug: Schema.String, id: SandboxScriptId, contentHash: Schema.String }),
	plugin: Schema.Struct({ revisionId: PluginRevisionId, configRevisionId: PluginConfigRevisionId }),
});
export type LifecyclePolicy = typeof LifecyclePolicy.Type;

/** A chunk's decisions, with the entity references its policies saw. */
export type PolicyDecisions = {
	readonly items: ReadonlyArray<PolicyDecision>;
	readonly references: Readonly<Record<string, AutomationEntityDraft>>;
};

/** An item after its policies: the request they left, or why they refused it. */
export type PolicyDecision = PolicyItem & {
	readonly error: null | ItemError;
	readonly rejected: null | Message;
	readonly patches: ReadonlyArray<AutomationPolicyPatch>;
};

/**
 * A prepared write as its policies see it. Items sharing a `subject` share a policy call, so a
 * once-per-subject policy runs once for them; a delete carries no properties schema.
 */
export type PolicyItem = {
	readonly subject: string;
	readonly itemIdentity: string;
	readonly request: AutomationRequestPayload;
	readonly propertiesSchema: null | AppSchema;
};

/** One chunk of a batch with the policies its request matched; no policies leaves it unchanged. */
export type MatchedPolicyChunk<T> = {
	readonly request: PolicyRequest;
	readonly items: ReadonlyArray<T>;
	readonly decisions: PolicyDecisions;
	readonly policies: ReadonlyArray<LifecyclePolicy>;
};

type ItemError =
	| { readonly code: "invalid-policy-transform" }
	| { readonly entityId: EntityId; readonly code: "reference-not-found" }
	| { readonly code: "invalid-properties"; readonly paths: ReadonlyArray<ReadonlyArray<string>> };

type PolicyBatch<T> = {
	readonly userId: null | UserId;
	readonly items: ReadonlyArray<T>;
	readonly resource: PolicyResource;
	readonly command: DomainLifecycleCommand;
	readonly policyItem: (item: T) => PolicyItem;
	readonly references?: Readonly<Record<string, AutomationEntityDraft>>;
};

export class LifecyclePolicies extends Context.Service<
	LifecyclePolicies,
	{
		/** The request's matching policies in call order, read on the caller's transaction. */
		match: (
			request: PolicyRequest,
			transaction: WriteTransaction,
		) => Effect.Effect<ReadonlyArray<LifecyclePolicy>, DbError>;
		/** Calls the policy once with every item it targets; untargeted items get no decision. */
		run: (input: {
			readonly request: PolicyRequest;
			readonly policy: LifecyclePolicy;
		}) => Effect.Effect<AutomationPolicyBatchOutput, DbError | AutomationPolicyExecutionError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/lifecycle/policies/LifecyclePolicies") {}

const POLICY_CHUNK_ITEMS = 50;

const unchanged = (item: PolicyItem): PolicyDecision => ({
	...item,
	error: null,
	patches: [],
	rejected: null,
});

/** The batch's items decided by no policy. */
export const unchangedPolicies = (
	items: ReadonlyArray<PolicyItem>,
	references: Readonly<Record<string, AutomationEntityDraft>>,
): PolicyDecisions => ({ references, items: items.map(unchanged) });

/**
 * Chunks a batch by count and bytes, a subject's items together, and matches each chunk's policies
 * on the caller's transaction.
 */
export const matchPolicies = <T>(
	batch: PolicyBatch<T>,
	transaction: WriteTransaction,
): Effect.Effect<ReadonlyArray<MatchedPolicyChunk<T>>, DbError, LifecyclePolicies> =>
	Effect.gen(function* () {
		const policies = yield* LifecyclePolicies;
		const references = batch.references ?? {};
		const chunks = lifecycleChunks(batch.items, {
			baseBytes: 0,
			maxItems: POLICY_CHUNK_ITEMS,
			sizeOf: (item) => batch.policyItem(item).request,
			subjectOf: (item) => batch.policyItem(item).subject,
		});
		return yield* Effect.forEach(chunks, (items) =>
			Effect.gen(function* () {
				const decided = items.map(batch.policyItem);
				const request: PolicyRequest = {
					references,
					resource: batch.resource,
					scopeUserId: batch.userId,
					causation: batch.command.causation,
					occurredAt: batch.command.occurredAt,
					items: decided.map((item) => ({
						request: item.request,
						itemIdentity: item.itemIdentity,
					})),
				};
				return {
					items,
					request,
					decisions: unchangedPolicies(decided, references),
					policies: decided.length === 0 ? [] : yield* policies.match(request, transaction),
				};
			}),
		);
	});

/** Whether no chunk matched a policy, so committing needs no policy call. */
export const unmatchedPolicies = (chunks: ReadonlyArray<MatchedPolicyChunk<unknown>>) =>
	chunks.every(({ policies }) => policies.length === 0);

const invalidProperties = (error: PropertyValidationError) => ({
	code: "invalid-properties" as const,
	paths: error.issues.map(({ path }) => path),
});

const propertiesSchemaOf = (item: PolicyItem) =>
	item.propertiesSchema === null
		? Effect.die("A policy item that writes properties has no properties schema")
		: Effect.succeed(item.propertiesSchema);

/**
 * Calls each matched policy of a chunk in order with the items earlier policies left active,
 * stopping once none are. A transformed event's new session entity is read with every other in one
 * statement per policy.
 */
const decideChunk = <T>(chunk: MatchedPolicyChunk<T>) =>
	Effect.gen(function* () {
		const policies = yield* LifecyclePolicies;
		const references: Record<string, AutomationEntityDraft> = { ...chunk.decisions.references };
		let { items } = chunk.decisions;
		for (const policy of chunk.policies) {
			const active = items.filter((item) => item.rejected === null && item.error === null);
			if (active.length === 0) {
				break;
			}
			const output = yield* policies.run({
				policy,
				request: {
					...chunk.request,
					references,
					items: active.map(({ request, itemIdentity }) => ({ request, itemIdentity })),
				},
			});
			const decisions = new Map(output.items.map((item) => [item.itemIdentity, item.decision]));
			const patched = yield* Effect.forEach(items, (item) =>
				Effect.gen(function* () {
					const decision = decisions.get(item.itemIdentity);
					if (!decision || item.rejected !== null || item.error !== null) {
						return item;
					}
					if (decision.action === "reject") {
						return { ...item, rejected: definitionText(policy.pluginId, decision.reason) };
					}
					if (decision.action === "allow") {
						return item;
					}
					const applied = applyLifecyclePolicyPatch(item.request, decision.patch);
					if (!applied.ok || applied.request.operation === "delete") {
						return { ...item, error: { code: "invalid-policy-transform" as const } };
					}
					const propertiesSchema = yield* propertiesSchemaOf(item);
					const properties = yield* parseAppSchemaProperties({
						kind: "Mutation",
						propertiesSchema,
						properties: applied.request.draft.properties,
						allowedMissingRequiredPaths: Object.keys(propertiesSchema.fields).map((key) => [key]),
					}).pipe(Effect.result);
					if (properties._tag === "Failure") {
						return { ...item, error: invalidProperties(properties.failure) };
					}
					const decoded = yield* Schema.decodeUnknownEffect(AutomationRequestPayload)({
						...applied.request,
						draft: {
							...applied.request.draft,
							properties: properties.success,
							...(applied.request.resource === "event"
								? {
										sessionEntityId: applied.request.draft.sessionEntityId?.trim()
											? EntityId.make(applied.request.draft.sessionEntityId.trim())
											: null,
									}
								: {}),
						},
					}).pipe(Effect.result);
					if (decoded._tag === "Failure") {
						return { ...item, error: { code: "invalid-policy-transform" as const } };
					}
					const request = decoded.success;
					const patch = canonicalLifecyclePolicyPatch(item.request, request);
					return { ...item, request, patches: patch ? [...item.patches, patch] : item.patches };
				}),
			);
			const missingSession = (item: PolicyDecision) =>
				item.error === null &&
				item.request.resource === "event" &&
				item.request.draft.sessionEntityId !== null &&
				!references[item.request.draft.sessionEntityId]
					? item.request.draft.sessionEntityId
					: null;
			const sessions = [...new Set(patched.flatMap((item) => missingSession(item) ?? []))];
			if (sessions.length > 0 && chunk.request.scopeUserId !== null) {
				const loaded = yield* automationEntityDrafts(chunk.request.scopeUserId, sessions);
				Object.assign(references, Object.fromEntries(loaded));
			}
			const checked: Array<PolicyDecision> = [];
			for (const item of patched) {
				const entityId = missingSession(item);
				checked.push(
					entityId === null
						? item
						: { ...item, error: { entityId, code: "reference-not-found" as const } },
				);
			}
			items = checked;
		}
		const validated = yield* Effect.forEach(items, (item) =>
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
					? { ...item, error: invalidProperties(parsed.failure) }
					: item;
			}),
		);
		return { references, items: validated } satisfies PolicyDecisions;
	});

/**
 * Runs each chunk's matched policies, outside any transaction. A policy that could not run for
 * want of capacity is `PolicyUnavailable`; one that failed otherwise refuses the batch.
 */
export const applyPolicies = <T>(chunks: ReadonlyArray<MatchedPolicyChunk<T>>) =>
	Effect.forEach(chunks, (chunk) =>
		Effect.map(decideChunk(chunk), (decisions) => ({ ...chunk, decisions })),
	).pipe(
		Effect.catchTag("AutomationPolicyExecutionError", (error) =>
			Effect.fail(
				isTransientKind(error.kind)
					? new PolicyUnavailable({ reason: { code: "policy-unavailable" } })
					: new PolicyRejected({ reason: { code: "policy-execution-failed" } }),
			),
		),
	);

/** Why policies refused a decided item, or null when they accepted it. */
export const policyFailureReason = (decision: PolicyDecision): null | PolicyFailureReason => {
	if (decision.rejected !== null) {
		return { code: "policy-rejected", message: decision.rejected };
	}
	if (decision.error === null) {
		return null;
	}
	return decision.error.code === "invalid-properties"
		? { code: decision.error.code, paths: decision.error.paths }
		: { code: "invalid-policy-transform" };
};

/**
 * Each item's accepted request by item identity; an item its policies refused fails as
 * `PolicyRejected`, and an undecided item has none.
 */
export const acceptedPolicyRequests = (
	chunks: ReadonlyArray<{ readonly decisions: PolicyDecisions }>,
) => {
	const decided = new Map(
		chunks.flatMap(({ decisions }) => decisions.items.map((item) => [item.itemIdentity, item])),
	);
	return (itemIdentity: string): Effect.Effect<null | PolicyDecision, PolicyRejected> => {
		const decision = decided.get(itemIdentity);
		if (!decision) {
			return Effect.succeed(null);
		}
		const reason = policyFailureReason(decision);
		return reason === null ? Effect.succeed(decision) : Effect.fail(new PolicyRejected({ reason }));
	};
};
