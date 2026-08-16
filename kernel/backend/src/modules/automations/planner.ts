import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationOmittedHook,
	AutomationRun,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	DEFAULT_POLICY_HOOK_POSITION,
	PluginManifest,
} from "@ryot-app/contract/modules/plugins/manifest";
import { AutomationHookSlug, PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import {
	LifecyclePlanner,
	lifecycleRunId,
	type LifecycleBatchInput,
	type LifecyclePlan,
	type LifecyclePlannedPolicy,
} from "#lib/domain/lifecycle";
import { lifecycleBatchTriggers } from "#lib/domain/lifecycle-batch";
import { AppConfig } from "#lib/infrastructure/config/service";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import { AutomationPlannerResolver } from "./planner-resolver";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const compareText = (a: string | null, b: string | null) => {
	if (a === b) {
		return 0;
	}
	if (a === null) {
		return -1;
	}
	if (b === null) {
		return 1;
	}
	return a < b ? -1 : 1;
};
const compareIdentity = (a: AutomationRun, b: AutomationRun) =>
	compareText(a.pluginId, b.pluginId) ||
	compareText(a.hookSlug, b.hookSlug) ||
	compareText(a.executionUserId, b.executionUserId);

const policyIdentity = (policy: Pick<AutomationRun, "pluginId" | "hookSlug">) =>
	stableStringify([policy.pluginId, policy.hookSlug]);
const normalizeExclusions = (
	policies: ReadonlyArray<Pick<AutomationRun, "pluginId" | "hookSlug">>,
) =>
	[
		...new Map(
			policies.map(({ pluginId, hookSlug }) => [
				policyIdentity({ pluginId, hookSlug }),
				{ pluginId, hookSlug },
			]),
		).values(),
	].sort((a, b) => compareText(a.pluginId, b.pluginId) || compareText(a.hookSlug, b.hookSlug));

export const LifecyclePlannerLive = Layer.effect(
	LifecyclePlanner,
	Effect.gen(function* () {
		const resolver = yield* AutomationPlannerResolver;
		const triggers = yield* AutomationTriggerRepository;
		const runs = yield* AutomationRunRepository;
		const { automations: limits } = yield* AppConfig;
		const orderedRuns = Effect.fn(function* (values: ReadonlyArray<AutomationRun>) {
			const db = yield* Database;
			const ids = [
				...new Set(
					values.flatMap((run) =>
						run.stage !== "before" || run.pluginRevisionId === null ? [] : [run.pluginRevisionId],
					),
				),
			];
			const revisions = ids.length
				? yield* mapDatabaseErrors(
						db.select().from(tables.pluginRevision).where(inArray(tables.pluginRevision.id, ids)),
					)
				: [];
			const declarations = yield* Effect.forEach(revisions, (revision) =>
				decodeStoredSchema(
					revision.manifest,
					PluginManifest,
					`Invalid pinned manifest ${revision.id}`,
				).pipe(Effect.map((manifest) => ({ manifest, id: revision.id }))),
			);
			const policies: LifecyclePlannedPolicy[] = [];
			for (const run of values) {
				if (run.stage !== "before") {
					continue;
				}
				const hook = declarations
					.find(({ id }) => id === run.pluginRevisionId)
					?.manifest.hooks.find(({ slug }) => slug === run.hookSlug);
				if (hook?.stage !== "before") {
					return yield* new DbError({ message: `Missing pinned policy declaration for ${run.id}` });
				}
				policies.push({
					runId: run.id,
					position: hook.position ?? DEFAULT_POLICY_HOOK_POSITION,
					...(hook.batchFrequency === undefined ? {} : { batchFrequency: hook.batchFrequency }),
				});
			}
			const position = (run: AutomationRun) =>
				policies.find(({ runId }) => runId === run.id)?.position ?? DEFAULT_POLICY_HOOK_POSITION;
			const ordered = [...values].sort(
				(a, b) => position(a) - position(b) || compareIdentity(a, b),
			);
			return {
				runs: ordered,
				policies: ordered.flatMap((run) => policies.filter(({ runId }) => runId === run.id)),
			};
		});
		const plan = Effect.fn("LifecyclePlanner.plan")(function* (input: {
			trigger: AutomationTrigger;
			recipients?: ReadonlyArray<UserId>;
			excludedOncePerSubjectPolicies?: ReadonlyArray<Pick<AutomationRun, "pluginId" | "hookSlug">>;
		}): Effect.fn.Return<LifecyclePlan, DbError, Database> {
			const suppliedTrigger = yield* decodeStoredSchema(
				input.trigger,
				AutomationTrigger,
				"Invalid lifecycle planning trigger",
			);
			const eventRequest =
				suppliedTrigger.payload?.category === "request" &&
				suppliedTrigger.payload.resource === "event"
					? suppliedTrigger.payload
					: null;
			const exclusions = eventRequest
				? normalizeExclusions(
						yield* decodeStoredSchema(
							input.excludedOncePerSubjectPolicies ?? [],
							Schema.Array(AutomationOmittedHook),
							"Invalid once-per-subject policy exclusions",
						),
					)
				: [];
			if (
				eventRequest?.excludedOncePerSubjectPolicies !== undefined &&
				stableStringify(normalizeExclusions(eventRequest.excludedOncePerSubjectPolicies)) !==
					stableStringify(exclusions)
			) {
				return yield* new DbError({
					message: "Event request exclusion snapshot conflicts with kernel planning input",
				});
			}
			const trigger = eventRequest
				? {
						...suppliedTrigger,
						payload: { ...eventRequest, excludedOncePerSubjectPolicies: exclusions },
					}
				: suppliedTrigger;
			const excludedIdentities = new Set(exclusions.map(policyIdentity));
			const signal = trigger.payload?.resource === "signal" ? trigger.payload : null;
			let recipients = [
				...new Set(
					signal
						? [
								...(input.recipients ?? []),
								...(signal.actorUserId === null ? [] : [signal.actorUserId]),
							]
						: [],
				),
			].sort(compareText);
			if (
				(!signal && input.recipients?.length) ||
				(trigger.payload?.resource === "provider-entity-import" &&
					trigger.payload.userId !== trigger.scopeUserId) ||
				trigger.payload === null ||
				trigger.payloadPrunedAt !== null ||
				trigger.blockedReason !== null
			) {
				return yield* new DbError({
					message: "Planning requires a fresh trigger payload and signal-only recipients",
				});
			}
			yield* resolver.lockCatalog(signal ? recipients : [trigger.scopeUserId]);
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${"automation-root:" + trigger.causation.rootExecutionId}))`,
				),
			);
			// Locks stay held through recipient and run writes so wasCreated describes the whole plan.
			const stored = yield* triggers.findById(trigger.id);
			if (stored) {
				const persistedTrigger = yield* triggers.insert({
					...trigger,
					blockedReason: stored.blockedReason,
				});
				const existing = yield* runs.listByTrigger(trigger.id);
				if (existing.some((run) => run.id !== lifecycleRunId(run))) {
					return yield* new DbError({ message: `Automation run identity conflict: ${trigger.id}` });
				}
				return { wasCreated: false, trigger: persistedTrigger, ...(yield* orderedRuns(existing)) };
			}
			if (signal && recipients.length) {
				const enabled = yield* mapDatabaseErrors(
					db
						.select({ id: tables.user.id })
						.from(tables.user)
						.where(and(inArray(tables.user.id, recipients), isNull(tables.user.disabledAt)))
						.orderBy(asc(tables.user.id))
						.for("share"),
				);
				recipients = recipients.filter((id) => enabled.some((user) => user.id === id));
			}
			const users = signal ? recipients : [trigger.scopeUserId];
			const matches = (yield* Effect.forEach(users, (userId) => resolver.resolve(trigger, userId)))
				.flat()
				.filter(
					({ hook, plugin }) =>
						!(
							eventRequest &&
							hook.stage === "before" &&
							hook.batchFrequency === "once-per-subject" &&
							excludedIdentities.has(
								policyIdentity({
									hookSlug: AutomationHookSlug.make(hook.slug),
									pluginId: plugin === null ? null : PluginId.make(plugin.id),
								}),
							)
						),
				);
			const planned = yield* Effect.forEach(
				matches,
				({ hook, plugin, script, executionUserId }) => {
					const identity = {
						executionUserId,
						triggerId: trigger.id,
						hookSlug: AutomationHookSlug.make(hook.slug),
						pluginId: plugin === null ? null : PluginId.make(plugin.id),
					};
					return decodeStoredSchema(
						{
							...identity,
							attemptCount: 0,
							startedAt: null,
							status: "queued",
							finishedAt: null,
							skipReason: null,
							stage: hook.stage,
							hookName: hook.name,
							nextAttemptAt: null,
							scriptSlug: script.slug,
							sandboxScriptId: script.id,
							queuedAt: trigger.createdAt,
							id: lifecycleRunId(identity),
							scriptContentHash: script.contentHash,
							pluginRevisionId: plugin?.pluginRevisionId ?? null,
							delivery: hook.stage === "before" ? "policy" : hook.delivery,
							pluginConfigRevisionId: plugin?.pluginConfigRevisionId ?? null,
							retryPolicy:
								hook.stage === "before" ? null : (hook.retry ?? DEFAULT_AUTOMATION_RETRY_POLICY),
							artifactsExpireAt: new Date(
								Date.parse(trigger.createdAt) + limits.retryWindowDays * 86_400_000,
							).toISOString(),
						},
						AutomationRun,
						"Invalid planned automation run",
					);
				},
			);
			const ordered = yield* orderedRuns(planned);
			const [accepted] = yield* mapDatabaseErrors(
				db
					.select({ count: count() })
					.from(tables.automationRun)
					.innerJoin(
						tables.automationTrigger,
						eq(tables.automationTrigger.id, tables.automationRun.triggerId),
					)
					.where(
						and(
							gt(tables.automationTrigger.depth, 0),
							eq(tables.automationTrigger.rootExecutionId, trigger.causation.rootExecutionId),
						),
					),
			);
			const blocked =
				trigger.causation.depth > limits.maxDepth ||
				(trigger.causation.depth > 0 &&
					(accepted?.count ?? 0) + ordered.runs.length > limits.maxRuns);
			const omittedHooks = [
				...new Map(
					ordered.runs.map(({ pluginId, hookSlug }) => [
						stableStringify([pluginId, hookSlug]),
						{ pluginId, hookSlug },
					]),
				).values(),
			].slice(0, 100);
			const persistedTrigger = yield* triggers.insert({
				...trigger,
				blockedReason: blocked
					? {
							omittedHooks,
							code: "automation-limit-reached",
							hasRequiredHooks: ordered.runs.some(({ delivery }) => delivery === "required"),
						}
					: null,
			});
			yield* triggers.insertRecipients(trigger.id, recipients);
			if (blocked) {
				return { runs: [], policies: [], wasCreated: true, trigger: persistedTrigger };
			}
			return {
				wasCreated: true,
				trigger: persistedTrigger,
				policies: ordered.policies,
				runs: yield* Effect.forEach(ordered.runs, (run) => runs.insertQueued(run)),
			};
		});
		const planBatch = Effect.fn("LifecyclePlanner.planBatch")(function* (
			input: LifecycleBatchInput,
		) {
			return yield* Effect.forEach(lifecycleBatchTriggers(input, limits.batchMaxItems), (trigger) =>
				plan({ trigger }),
			);
		});
		return { plan, planBatch };
	}),
).pipe(
	Layer.provide(
		Layer.mergeAll(
			AutomationPlannerResolver.layer,
			AutomationRunRepository.layer,
			AutomationTriggerRepository.layer,
		),
	),
);
