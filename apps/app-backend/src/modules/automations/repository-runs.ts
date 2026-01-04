import { DbError } from "@ryot/contract/errors";
import type { AutomationContext } from "@ryot/contract/modules/automations/schemas";
import {
	EntitySchemaId,
	EventSchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
	SignalSchemaId,
	type AutomationRuleId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { and, count, eq } from "drizzle-orm";
import { DateTime, Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import {
	boundSandboxError,
	boundSandboxLogs,
	boundSandboxValue,
} from "#lib/infrastructure/sandbox-runtime/serialization-bounds";

import { boundTriggerSnapshot } from "./artifact-bounds";
import { resolveRuleCapabilityCeiling } from "./capabilities";

export const makeAutomationRunRepository = () => {
	const reserveEffect = Effect.fn("AutomationsRepository.reserveEffect")(function* (input: {
		id: string;
		runId: string;
		effectKey: string;
		inputHash: string;
		correlationId: string;
		hostFunction: string;
		correlationUnits: number;
	}) {
		const db = yield* CurrentDb;
		const [run] = yield* dbEffect(() =>
			db
				.select({ id: schema.subscriptionRun.id })
				.from(schema.subscriptionRun)
				.where(eq(schema.subscriptionRun.id, input.runId))
				.for("update")
				.limit(1),
		);
		if (!run) {
			return { kind: "run_not_found" as const };
		}
		const [existing] = yield* dbEffect(() =>
			db
				.select()
				.from(schema.automationEffect)
				.where(eq(schema.automationEffect.id, input.id))
				.limit(1),
		);
		if (existing) {
			return existing.inputHash === input.inputHash
				? { kind: "existing" as const, effect: existing }
				: { kind: "conflict" as const };
		}
		const [effectCount] = yield* dbEffect(() =>
			db
				.select({ count: count() })
				.from(schema.automationEffect)
				.where(eq(schema.automationEffect.parentRunId, input.runId)),
		);
		if ((effectCount?.count ?? 0) >= 32) {
			return { kind: "budget_exceeded" as const };
		}

		yield* dbEffect(() =>
			db
				.insert(schema.automationCorrelationBudget)
				.values({ correlationId: input.correlationId })
				.onConflictDoNothing(),
		);
		const [budget] = yield* dbEffect(() =>
			db
				.select()
				.from(schema.automationCorrelationBudget)
				.where(eq(schema.automationCorrelationBudget.correlationId, input.correlationId))
				.for("update")
				.limit(1),
		);
		if (!budget || budget.consumedUnits + input.correlationUnits > 256) {
			return { kind: "budget_exceeded" as const };
		}
		if (input.correlationUnits > 0) {
			yield* dbEffect(() =>
				db
					.update(schema.automationCorrelationBudget)
					.set({ consumedUnits: budget.consumedUnits + input.correlationUnits })
					.where(eq(schema.automationCorrelationBudget.correlationId, input.correlationId)),
			);
		}
		const [effect] = yield* dbEffect(() =>
			db
				.insert(schema.automationEffect)
				.values({
					id: input.id,
					status: "pending",
					parentRunId: input.runId,
					effectKey: input.effectKey,
					inputHash: input.inputHash,
					hostFunction: input.hostFunction,
					correlationId: input.correlationId,
					correlationUnits: input.correlationUnits,
				})
				.returning(),
		);
		if (!effect) {
			return yield* new DbError({ message: "Automation effect insert failed" });
		}
		return { kind: "reserved" as const, effect };
	});

	const finishEffect = Effect.fn("AutomationsRepository.finishEffect")(function* (input: {
		id: string;
		result: unknown;
		status: "accepted" | "failed";
		downstreamExecutionId?: string | undefined;
	}) {
		const db = yield* CurrentDb;
		yield* dbEffect(() =>
			db
				.update(schema.automationEffect)
				.set({
					result: input.result,
					status: input.status,
					downstreamExecutionId: input.downstreamExecutionId,
				})
				.where(eq(schema.automationEffect.id, input.id)),
		);
	});

	const prepareSubscriptionRun = Effect.fn("AutomationsRepository.prepareSubscriptionRun")(
		function* (input: {
			runId: string;
			correlationId: string;
			ruleId: AutomationRuleId;
			automation: AutomationContext;
			executionUserId: UserId | null;
		}) {
			const db = yield* CurrentDb;
			const [existing] = yield* dbEffect(() =>
				db
					.select()
					.from(schema.subscriptionRun)
					.where(eq(schema.subscriptionRun.id, input.runId))
					.limit(1),
			);
			if (existing) {
				if (existing.status !== "queued" && existing.status !== "running") {
					return { kind: "finished" as const };
				}
				return {
					run: existing,
					kind: "resumable" as const,
					metadata: existing.ruleSnapshot.metadata,
					scriptId: existing.ruleSnapshot.sandboxScriptId,
					capabilityCeiling: existing.ruleSnapshot.effectiveHostFunctions,
				};
			}
			const [rule] = yield* dbEffect(() =>
				db
					.select({
						name: schema.automationRule.name,
						kind: schema.automationRule.kind,
						scriptId: schema.sandboxScript.id,
						userId: schema.automationRule.userId,
						metadata: schema.automationRule.metadata,
						isActive: schema.automationRule.isActive,
						operation: schema.automationRule.operation,
						scriptMetadata: schema.sandboxScript.metadata,
						entitySchemaId: schema.automationRule.entitySchemaId,
						eventSchemaId: schema.automationRule.eventSchemaId,
						signalSchemaId: schema.automationRule.signalSchemaId,
						relationshipSchemaId: schema.automationRule.relationshipSchemaId,
					})
					.from(schema.automationRule)
					.innerJoin(
						schema.sandboxScript,
						eq(schema.sandboxScript.id, schema.automationRule.sandboxScriptId),
					)
					.where(eq(schema.automationRule.id, input.ruleId))
					.for("update", { of: schema.automationRule })
					.limit(1),
			);
			if (!rule || !rule.isActive || rule.kind !== "subscription") {
				return { kind: "not_active" as const };
			}
			const occurrenceTarget = (() => {
				const source = input.automation.source;
				if (source.kind === "signal") {
					return { kind: "signal" as const, id: source.signal.schema.id };
				}
				if (source.kind === "entity") {
					const snapshot = source.after ?? source.before;
					if (!snapshot) {
						return null;
					}
					return { kind: "entity" as const, id: snapshot.entitySchemaId };
				}
				if (source.kind === "event") {
					const snapshot = source.after ?? source.before;
					if (!snapshot) {
						return null;
					}
					return { kind: "event" as const, id: snapshot.eventSchemaId };
				}
				const snapshot = source.after ?? source.before;
				if (!snapshot) {
					return null;
				}
				return { kind: "relationship" as const, id: snapshot.relationshipSchemaId };
			})();
			const targetMatches =
				occurrenceTarget &&
				((occurrenceTarget.kind === "entity" && rule.entitySchemaId === occurrenceTarget.id) ||
					(occurrenceTarget.kind === "event" && rule.eventSchemaId === occurrenceTarget.id) ||
					(occurrenceTarget.kind === "signal" && rule.signalSchemaId === occurrenceTarget.id) ||
					(occurrenceTarget.kind === "relationship" &&
						rule.relationshipSchemaId === occurrenceTarget.id));
			if (!targetMatches || rule.operation !== input.automation.operation) {
				return { kind: "not_active" as const };
			}
			const allowedHostFunctions = rule.scriptMetadata.allowedHostFunctions ?? [];
			const effectiveHostFunctions = resolveRuleCapabilityCeiling({
				scriptAllowlist: allowedHostFunctions,
				isGlobalRule: rule.userId === null,
			});
			let target;
			if (rule.signalSchemaId) {
				target = { kind: "signal" as const, id: SignalSchemaId.make(rule.signalSchemaId) };
			} else if (rule.eventSchemaId) {
				target = { kind: "event" as const, id: EventSchemaId.make(rule.eventSchemaId) };
			} else if (rule.relationshipSchemaId) {
				target = {
					kind: "relationship" as const,
					id: RelationshipSchemaId.make(rule.relationshipSchemaId),
				};
			} else if (rule.entitySchemaId) {
				target = { kind: "entity" as const, id: EntitySchemaId.make(rule.entitySchemaId) };
			} else {
				return yield* new DbError({ message: "Automation rule has no target" });
			}
			const source = input.automation.source;
			const isSignal = source.kind === "signal";
			const record = isSignal ? source.signal.id : (source.after?.id ?? source.before?.id);
			const queuedAt = yield* DateTime.nowAsDate;
			const [run] = yield* dbEffect(() =>
				db
					.insert(schema.subscriptionRun)
					.values({
						queuedAt,
						id: input.runId,
						status: "queued",
						ruleId: input.ruleId,
						originalRuleId: input.ruleId,
						recordId: isSignal ? null : record,
						correlationId: input.correlationId,
						operation: input.automation.operation,
						executionUserId: input.executionUserId,
						sourceKind: isSignal ? null : source.kind,
						signalId: isSignal ? source.signal.id : null,
						automationDepth: input.automation.automationDepth,
						lifecycleOccurrenceId: isSignal ? null : input.automation.occurrenceId,
						triggerSnapshot: boundTriggerSnapshot({ automation: input.automation }),
						ruleSnapshot: {
							target,
							name: rule.name,
							kind: rule.kind,
							effectiveHostFunctions,
							metadata: rule.metadata,
							operation: rule.operation,
							sandboxScriptId: SandboxScriptId.make(rule.scriptId),
						},
					})
					.returning(),
			);
			if (!run) {
				return yield* new DbError({ message: "Subscription run insert failed" });
			}
			return {
				run,
				metadata: rule.metadata,
				scriptId: rule.scriptId,
				kind: "created" as const,
				capabilityCeiling: effectiveHostFunctions,
			};
		},
	);

	const markRunRunning = Effect.fn("AutomationsRepository.markRunRunning")(function* (
		runId: string,
	) {
		const db = yield* CurrentDb;
		const now = yield* DateTime.nowAsDate;
		const [runState] = yield* dbEffect(() =>
			db
				.select({
					disabledAt: schema.user.disabledAt,
					status: schema.subscriptionRun.status,
				})
				.from(schema.subscriptionRun)
				.leftJoin(schema.user, eq(schema.user.id, schema.subscriptionRun.executionUserId))
				.where(eq(schema.subscriptionRun.id, runId))
				.limit(1),
		);
		if (runState?.status === "running") {
			return true;
		}
		if (runState?.status !== "queued") {
			return false;
		}
		if (runState.disabledAt) {
			yield* dbEffect(() =>
				db
					.update(schema.subscriptionRun)
					.set({
						finishedAt: now,
						status: "skipped",
						skippedReason: { kind: "user_disabled" },
					})
					.where(
						and(eq(schema.subscriptionRun.id, runId), eq(schema.subscriptionRun.status, "queued")),
					),
			);
			return false;
		}
		const running = yield* dbEffect(() =>
			db
				.update(schema.subscriptionRun)
				.set({ status: "running", startedAt: now })
				.where(
					and(eq(schema.subscriptionRun.id, runId), eq(schema.subscriptionRun.status, "queued")),
				)
				.returning({ id: schema.subscriptionRun.id }),
		);
		return running.length > 0;
	});

	const completeSubscriptionRun = Effect.fn("AutomationsRepository.completeSubscriptionRun")(
		function* (input: {
			runId: string;
			value: unknown;
			error: string | null;
			logs: ReadonlyArray<string>;
			timing?: { totalMs: number; executionMs: number } | undefined;
			scriptAudit?: { hash: string; updatedAt: string } | undefined;
		}) {
			const db = yield* CurrentDb;
			const finishedAt = yield* DateTime.nowAsDate;
			const scriptUpdatedAt = input.scriptAudit
				? DateTime.toDate(DateTime.unsafeMake(input.scriptAudit.updatedAt))
				: undefined;
			const boundedValue = boundSandboxValue(input.value);
			const resultTooLarge = boundedValue.kind === "result_too_large";
			const error = resultTooLarge
				? `result_too_large: sandbox value was ${boundedValue.byteSize} bytes`
				: input.error;
			yield* dbEffect(() =>
				db
					.update(schema.subscriptionRun)
					.set({
						finishedAt,
						scriptUpdatedAt,
						timing: input.timing,
						error: boundSandboxError(error),
						scriptHash: input.scriptAudit?.hash,
						logs: boundSandboxLogs(input.logs),
						status: error === null ? "succeeded" : "failed",
						value: boundedValue.kind === "accepted" ? boundedValue.value : null,
					})
					.where(
						and(
							eq(schema.subscriptionRun.id, input.runId),
							eq(schema.subscriptionRun.status, "running"),
						),
					),
			);
		},
	);

	return {
		finishEffect,
		reserveEffect,
		markRunRunning,
		prepareSubscriptionRun,
		completeSubscriptionRun,
	};
};
