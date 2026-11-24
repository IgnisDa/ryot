import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationHookSlug, PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import { lifecycleBatchTriggers } from "#modules/automations/lifecycle/batch";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import {
	type LifecycleBatchChange,
	type LifecycleBatchInput,
	type LifecycleDispatchPlan,
	LifecyclePlanner,
	type LifecyclePlanningResult,
	lifecycleRunId,
	LifecycleWork,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { writeState, type WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";

import type { BatchHookPin } from "./batch-hook-pin";
import { AutomationPlannerResolver, matchesTarget } from "./planner-resolver";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const compareText = (a: null | string, b: null | string) => {
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
const orderedRuns = (values: ReadonlyArray<AutomationRun>) => [...values].sort(compareIdentity);

type OpenBatch = {
	maxItems: number;
	readonly candidates: ReadonlyArray<BatchHookPin>;
	dispatch: null | ReadonlyArray<LifecycleDispatchPlan>;
	readonly changes: Array<LifecycleBatchChange & { readonly index: number }>;
};

// A batch opens and seals inside one transaction, so its state lives and dies with that transaction.
const openBatches = writeState((_: WriteTransaction) => new Map<string, OpenBatch>());

const batchId = (input: LifecycleBatchInput) =>
	sha256Base64Url(
		stableStringify([
			input.resource,
			input.identity,
			input.command.itemIdentity,
			input.command.causation.executionId,
		]),
	);

export const LifecyclePlannerLive = Layer.effect(
	LifecyclePlanner,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const resolver = yield* AutomationPlannerResolver;
		const triggers = yield* AutomationTriggerRepository;
		const runs = yield* AutomationRunRepository;
		const work = yield* LifecycleWork;
		const { automations: limits } = yield* AppConfig;
		const replayExisting = Effect.fn("LifecyclePlanner.replayExisting")(function* (
			trigger: AutomationTrigger,
			stored: AutomationTrigger,
		) {
			// A retried write recomputes its trigger's timestamps and snapshots; the first attempt's row stands.
			const persistedTrigger =
				trigger.payload?.resource === "signal"
					? yield* triggers.insert({ ...trigger, blockedReason: stored.blockedReason })
					: stored;
			const existing = yield* runs.listByTrigger(trigger.id);
			if (existing.some((run) => run.id !== lifecycleRunId(run))) {
				return yield* new DbError({ message: `Automation run identity conflict: ${trigger.id}` });
			}
			return { wasCreated: false, trigger: persistedTrigger, runs: orderedRuns(existing) };
		});
		const plan = Effect.fn("LifecyclePlanner.plan")(function* (input: {
			trigger: AutomationTrigger;
			transaction: WriteTransaction;
			recipients?: ReadonlyArray<UserId>;
			pinnedBatchCandidates?: ReadonlyArray<BatchHookPin>;
		}): Effect.fn.Return<LifecyclePlanningResult, DbError> {
			const trigger = yield* decodeStoredSchema(
				input.trigger,
				AutomationTrigger,
				"Invalid lifecycle planning trigger",
			);
			if (trigger.kind.category === "request") {
				return yield* new DbError({ message: "Request triggers run policies, not planned hooks" });
			}
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
			const payload = trigger.payload;
			if (!input.pinnedBatchCandidates) {
				yield* resolver.lockCatalog(signal ? recipients : [trigger.scopeUserId], input.transaction);
			}
			// Catalog locks remain held while matching hooks and writing the selected runs.
			const stored = yield* triggers.findById(trigger.id);
			if (stored) {
				return yield* replayExisting(trigger, stored);
			}
			if (signal && recipients.length) {
				const enabled = yield* session.run((db) =>
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
			const matches = input.pinnedBatchCandidates
				? input.pinnedBatchCandidates
						.filter(
							(candidate) =>
								candidate.references.scopeUserId === trigger.scopeUserId &&
								candidate.payload.hook.targets.some((target) =>
									matchesTarget(definitionOwner(candidate.references.pluginId), target, trigger),
								),
						)
						.map(({ references, payload: pinned }) => ({
							hook: pinned.hook,
							executionUserId: references.scopeUserId,
							script: {
								slug: pinned.scriptSlug,
								id: references.sandboxScriptId,
								contentHash: pinned.scriptContentHash,
							},
							plugin: {
								id: references.pluginId,
								pluginRevisionId: references.pluginRevisionId,
								pluginConfigRevisionId: references.pluginConfigRevisionId,
							},
						}))
				: (yield* Effect.forEach(users, (userId) =>
						resolver.resolve(trigger, userId, input.transaction),
					)).flat();
			const queuedAt = DateTime.formatIso(yield* DateTime.now);
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
							queuedAt,
							attemptCount: 0,
							startedAt: null,
							status: "queued",
							finishedAt: null,
							skipReason: null,
							hookName: hook.name,
							nextAttemptAt: null,
							scriptSlug: script.slug,
							sandboxScriptId: script.id,
							id: lifecycleRunId(identity),
							scriptContentHash: script.contentHash,
							pluginRevisionId: plugin?.pluginRevisionId ?? null,
							pluginConfigRevisionId: plugin?.pluginConfigRevisionId ?? null,
							retryPolicy:
								hook.stage === "after" ? (hook.retry ?? DEFAULT_AUTOMATION_RETRY_POLICY) : null,
							artifactsExpireAt: new Date(
								Date.parse(trigger.createdAt) + limits.retryWindowDays * 86_400_000,
							).toISOString(),
						},
						AutomationRun,
						"Invalid planned automation run",
					);
				},
			);
			const ordered = orderedRuns(planned);
			if (ordered.length === 0 && trigger.payload.resource !== "signal") {
				return { runs: [], trigger: null, _tag: "NoHooks", wasCreated: false };
			}
			yield* session.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${"automation-root:" + trigger.causation.rootExecutionId}))`,
				),
			);
			const raced = yield* triggers.findById(trigger.id);
			if (raced) {
				return yield* replayExisting(trigger, raced);
			}
			const [accepted] = yield* session.run((db) =>
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
				(trigger.causation.depth > 0 && (accepted?.count ?? 0) + ordered.length > limits.maxRuns);
			const omittedHooks = [
				...new Map(
					ordered.map(({ pluginId, hookSlug }) => [
						stableStringify([pluginId, hookSlug]),
						{ pluginId, hookSlug },
					]),
				).values(),
			].slice(0, 100);
			const persistedTrigger = yield* triggers.insert({
				...trigger,
				blockedReason: blocked ? { omittedHooks, code: "automation-limit-reached" } : null,
			});
			yield* triggers.insertRecipients(trigger.id, recipients);
			if (blocked) {
				return { runs: [], wasCreated: true, trigger: persistedTrigger };
			}
			return {
				wasCreated: true,
				trigger: persistedTrigger,
				runs: yield* runs.insertQueued({ runs: ordered, triggerPayload: payload }),
			};
		});
		const prepareBatch = Effect.fn("LifecyclePlanner.prepareBatch")(function* (
			transaction: WriteTransaction,
			input: LifecycleBatchInput & { scopes: ReadonlyArray<null | UserId> },
		) {
			const id = batchId(input);
			const batches = openBatches(transaction);
			const existing = batches.get(id);
			if (existing) {
				return { id, hasCandidates: existing.candidates.length > 0 };
			}
			const scopes = [...new Set(input.scopes)].sort((a, b) => (a ?? "").localeCompare(b ?? ""));
			yield* resolver.lockCatalog(scopes, transaction);
			const candidates = (yield* Effect.forEach(scopes, (userId) =>
				resolver.resolveBatchCandidates({
					userId,
					transaction,
					resource: input.resource,
					source: input.command.causation.source,
				}),
			)).flat();
			batches.set(id, { candidates, changes: [], dispatch: null, maxItems: limits.batchMaxItems });
			return { id, hasCandidates: candidates.length > 0 };
		});
		const recordBatchChange = Effect.fn("LifecyclePlanner.recordBatchChange")(function* (
			transaction: WriteTransaction,
			id: string,
			change: LifecycleBatchChange & { readonly index: number },
		) {
			const batch = openBatches(transaction).get(id);
			if (!batch) {
				return yield* new DbError({ message: `Missing batch decision ${id}` });
			}
			if (batch.candidates.length > 0) {
				batch.changes.push(change);
			}
			return undefined;
		});
		const planBatch = Effect.fn("LifecyclePlanner.planBatch")(function* (
			transaction: WriteTransaction,
			input: LifecycleBatchInput,
		) {
			const id = batchId(input);
			const contents = openBatches(transaction).get(id);
			if (!contents) {
				return yield* new DbError({ message: `Missing batch decision ${id}` });
			}
			if (contents.dispatch) {
				return contents.dispatch;
			}
			const { candidates } = contents;
			const changes = sortBy(contents.changes, (change) => change.index).flatMap(
				({ payload, scopeUserId }) =>
					payload.resource === input.resource ? [{ payload, scopeUserId }] : [],
			);
			const changeTriggers = yield* Effect.forEach(changes, ({ payload, scopeUserId }, index) =>
				Effect.map(
					lifecycleTrigger(input.command, scopeUserId, payload, `batch-evidence:${index}`),
					(trigger) => ({ trigger, scopeUserId }),
				),
			);
			const maxItems = candidates.reduce((globalMaxItems, { payload, references }) => {
				const { hook } = payload;
				if (
					hook.stage !== "after" ||
					hook.frequency !== "batch" ||
					hook.batchMaxItems === undefined
				) {
					return globalMaxItems;
				}
				const matchesCommittedItem = changeTriggers.some(
					({ trigger, scopeUserId }) =>
						scopeUserId === references.scopeUserId &&
						hook.targets.some((target) =>
							matchesTarget(definitionOwner(references.pluginId), target, trigger),
						),
				);
				return matchesCommittedItem ? Math.min(globalMaxItems, hook.batchMaxItems) : globalMaxItems;
			}, contents.maxItems);
			const planned = yield* Effect.forEach(
				yield* lifecycleBatchTriggers(input, maxItems, changes),
				(trigger) => plan({ trigger, transaction, pinnedBatchCandidates: candidates }),
			);
			const dispatch = planned.flatMap((item) =>
				item.trigger === null ? [] : [toLifecycleDispatchPlan(item)],
			);
			contents.dispatch = dispatch;
			return dispatch;
		});
		const planChanges = (
			changes: ReadonlyArray<AutomationTrigger>,
			transaction: WriteTransaction,
		): Effect.Effect<ReadonlyArray<ReadonlyArray<LifecycleDispatchPlan>>, DbError> =>
			Effect.gen(function* () {
				const [first] = changes;
				if (first === undefined) {
					return [];
				}
				const plans = yield* Effect.forEach(changes, (trigger) =>
					Effect.map(plan({ trigger, transaction }), (planned) =>
						planned.trigger === null ? [] : [toLifecycleDispatchPlan(planned)],
					),
				);
				const derived = (yield* planChanges(
					yield* work.derive(changes, transaction),
					transaction,
				)).flat();
				const [leading = [], ...rest] = plans;
				return [[...leading, ...derived], ...rest];
			});
		const planChange = (input: { trigger: AutomationTrigger }, transaction: WriteTransaction) =>
			Effect.map(planChanges([input.trigger], transaction), (plans) => plans.flat());
		return {
			plan,
			planBatch,
			planChange,
			planChanges,
			prepareBatch,
			recordBatchChange,
			lockCatalog: resolver.lockCatalog,
		};
	}),
);
