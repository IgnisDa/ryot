import { DbError } from "@ryot-app/contract/errors";
import {
	AUTOMATION_HISTORY_LIMITS,
	type AutomationHistoryAttempt,
} from "@ryot-app/contract/modules/automations/history-schemas";
import {
	AutomationRunAttempt,
	AutomationRunSkipReason,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationRunAttemptId,
	type AutomationRunId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Schema } from "effect";

import { automationRunRetryEligibility } from "#lib/infrastructure/db/automation-retry-eligibility";
import { user } from "#lib/infrastructure/db/schema/tables/auth";
import {
	automationRun,
	automationRunAttempt as table,
} from "#lib/infrastructure/db/schema/tables/automations";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";
import { makeSandboxObservabilityCollector } from "#lib/infrastructure/sandbox-runtime/observability-host-functions";

import { automaticRetryAt, isRetryableAutomationFailure } from "./retry-policy";

export const AUTOMATION_ATTEMPT_ARTIFACT_BYTES = SANDBOX_LIMITS.logs.totalBytes;
export const AUTOMATION_ATTEMPT_TRUNCATION_MARKER = "[automation attempt artifact truncated]";

const boundedPreview = <A>(serialized: string, wrap: (preview: string) => A): A => {
	let low = 0;
	let high = serialized.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (
			utf8ByteLength(stableStringify(wrap(serialized.slice(0, middle)))) <=
			AUTOMATION_ATTEMPT_ARTIFACT_BYTES
		) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	return wrap(serialized.slice(0, low));
};

export type FinalizeAutomationAttempt = Pick<
	AutomationRunAttempt,
	"runId" | "attemptNumber" | "logs" | "error" | "returnedValue" | "timing"
> &
	(
		| { status: "succeeded"; failureKind: null }
		| { status: "failed"; failureKind: NonNullable<AutomationRunAttempt["failureKind"]> }
	);

const bound = <A>(value: A, wrap: (preview: string, digest: string) => A): A => {
	const serialized = stableStringify(value);
	if (utf8ByteLength(serialized) <= AUTOMATION_ATTEMPT_ARTIFACT_BYTES) {
		return value;
	}
	const digest = sha256Base64Url(serialized);
	return boundedPreview(serialized, (preview) => wrap(preview, digest));
};

export const boundAutomationAttemptArtifacts = (
	input: Pick<AutomationRunAttempt, "logs" | "error" | "returnedValue">,
) => {
	const marker = AUTOMATION_ATTEMPT_TRUNCATION_MARKER;
	return {
		returnedValue: bound(input.returnedValue, (preview, digest) => ({ marker, digest, preview })),
		error: bound(input.error, (preview, digest) => ({
			message: preview,
			code: `${marker}:${digest}`,
		})),
		logs: bound(input.logs, (preview, digest) => [
			{ message: marker, level: "warning" as const, attributes: { digest, preview } },
		]),
	};
};

const historyBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const DiagnosticLog = Schema.Struct(AutomationRunAttempt.fields.logs.members[0].value.fields);

export const projectAutomationAttemptHistory = (
	attempt: Pick<AutomationRunAttempt, "logs" | "error" | "failureKind">,
): {
	historyLogs: AutomationHistoryAttempt["logs"];
	historyError: AutomationHistoryAttempt["error"];
	historyArtifactsTruncated: boolean;
} => {
	const limit = AUTOMATION_HISTORY_LIMITS.attemptBytes;
	const collector = makeSandboxObservabilityCollector();
	let truncated = false;
	const sanitize = (entry: typeof DiagnosticLog.Type) => {
		if (historyBytes(entry) > limit || collector.record("log", [entry]) !== null) {
			truncated = true;
			return null;
		}
		const serialized = collector.logs[collector.logs.length - 1];
		const sanitized = Schema.decodeSync(Schema.fromJsonString(DiagnosticLog))(serialized ?? "null");
		if (historyBytes(sanitized) > limit) {
			truncated = true;
			return null;
		}
		return sanitized;
	};
	let error =
		attempt.error === null
			? null
			: {
					code: attempt.failureKind ?? "execution-failed",
					message:
						sanitize({ level: "error", message: attempt.error.message })?.message ??
						"[History error omitted: size limit]",
				};
	if (error !== null && historyBytes({ error, logs: [] }) > limit) {
		error = { ...error, message: "[History error omitted: size limit]" };
		truncated = true;
	}
	let used = historyBytes({ error, logs: [] });
	let count = 0;
	const logs =
		attempt.logs === null
			? null
			: attempt.logs.flatMap((entry) => {
					const value = sanitize(entry);
					if (value === null) {
						return [];
					}
					const size = historyBytes(value) + (count === 0 ? 0 : 1);
					if (used + size > limit) {
						truncated = true;
						return [];
					}
					used += size;
					count += 1;
					return [value];
				});
	return { historyLogs: logs, historyError: error, historyArtifactsTruncated: truncated };
};

export const automationAttemptIdentity = (runId: AutomationRunId, attemptNumber: number) => {
	const hash = sha256Base64Url(stableStringify([runId, attemptNumber]));
	return {
		id: AutomationRunAttemptId.make(`attempt_${hash}`),
		workflowExecutionId: AutomationExecutionId.make(`automation_attempt_${hash}`),
	};
};

const decodeRow = ({
	historyLogs: _historyLogs,
	historyError: _historyError,
	historyArtifactsTruncated: _historyArtifactsTruncated,
	...row
}: typeof table.$inferSelect) =>
	decodeStoredSchema(
		{
			...row,
			startedAt: row.startedAt.toISOString(),
			finishedAt: row.finishedAt?.toISOString() ?? null,
			artifactsPrunedAt: row.artifactsPrunedAt?.toISOString() ?? null,
		},
		AutomationRunAttempt,
		`Invalid automation attempt ${row.id}`,
	);

const conflict = (message: string) => new DbError({ message });
const userDisabled = Schema.decodeSync(AutomationRunSkipReason)({ code: "user-disabled" });
const validateTime = (now: Date) =>
	Number.isFinite(now.getTime()) ? Effect.void : Effect.fail(conflict("Invalid attempt time"));

const atomic = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const db = yield* Database;
		return yield* mapDatabaseErrors(
			db.transaction((tx) => effect.pipe(Effect.provideService(Database, tx))),
		);
	});

const lockRun = Effect.fn(function* (runId: AutomationRunId) {
	const db = yield* Database;
	const [run] = yield* db
		.select()
		.from(automationRun)
		.where(eq(automationRun.id, runId))
		.for("update");
	if (!run) {
		return yield* conflict(`Automation run not found: ${runId}`);
	}
	return run;
});

const retryRun = alias(automationRun, "retry_run");

const lockedRetryEligibility = Effect.fn(function* (runId: AutomationRunId, now: Date) {
	const db = yield* Database;
	const [row] = yield* db
		.select({
			reason: automationRunRetryEligibility("retry_run", sql`${now.toISOString()}::timestamptz`, {
				lockArtifacts: true,
			}),
		})
		.from(retryRun)
		.where(eq(retryRun.id, runId));
	if (!row) {
		return yield* conflict(`Automation run not found: ${runId}`);
	}
	return row.reason;
});

const retryEligibility = (runId: AutomationRunId, now: Date) =>
	atomic(
		Effect.gen(function* () {
			yield* validateTime(now);
			yield* lockRun(runId);
			return yield* lockedRetryEligibility(runId, now);
		}),
	);

const queueRetry = (input: { runId: AutomationRunId; expectedAttemptCount: number; now: Date }) =>
	atomic(
		Effect.gen(function* () {
			yield* validateTime(input.now);
			const run = yield* lockRun(input.runId);
			if (run.attemptCount !== input.expectedAttemptCount || run.attemptCount < 1) {
				return yield* conflict("Manual retry attempt count conflict");
			}
			const reason = yield* lockedRetryEligibility(input.runId, input.now);
			if (reason) {
				return yield* conflict(`Manual retry unavailable: ${reason}`);
			}
			const db = yield* Database;
			yield* db
				.update(automationRun)
				.set({ status: "queued", finishedAt: null, nextAttemptAt: input.now })
				.where(
					and(
						eq(automationRun.id, run.id),
						eq(automationRun.status, "failed"),
						eq(automationRun.attemptCount, input.expectedAttemptCount),
					),
				);
			return {
				runId: input.runId,
				attemptNumber: run.attemptCount + 1,
				...automationAttemptIdentity(input.runId, run.attemptCount + 1),
			};
		}),
	);

export class AutomationAttemptRepository extends Context.Service<AutomationAttemptRepository>()(
	"AutomationAttemptRepository",
	{
		make: Effect.sync(() => {
			const findAttempt = Effect.fn(function* (runId: AutomationRunId, attemptNumber: number) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(table)
						.where(and(eq(table.runId, runId), eq(table.attemptNumber, attemptNumber))),
				);
				return row ? yield* decodeRow(row) : null;
			});
			const claimNextAttempt = (input: {
				runId: AutomationRunId;
				attemptNumber: number;
				now: Date;
			}) =>
				atomic(
					Effect.gen(function* () {
						yield* validateTime(input.now);
						const run = yield* lockRun(input.runId);
						const existing = yield* findAttempt(input.runId, input.attemptNumber);
						if (existing) {
							return { claimed: false, attempt: existing };
						}
						if (
							run.status === "skipped" &&
							run.skipReason?.code === "user-disabled" &&
							input.attemptNumber === run.attemptCount + 1
						) {
							return { attempt: null, claimed: false };
						}
						if (
							run.status === "failed" &&
							run.attemptCount > 0 &&
							input.attemptNumber === run.attemptCount + 1 &&
							run.artifactsExpireAt <= input.now
						) {
							return { attempt: null, claimed: false };
						}
						if (
							!Number.isSafeInteger(input.attemptNumber) ||
							input.attemptNumber !== run.attemptCount + 1 ||
							run.status !== "queued" ||
							run.queuedAt > input.now ||
							(run.nextAttemptAt !== null && run.nextAttemptAt > input.now) ||
							(run.stage === "before" && input.attemptNumber !== 1)
						) {
							return yield* conflict("Automation attempt claim conflict or not due");
						}
						const db = yield* Database;
						if (run.executionUserId !== null) {
							const [executionUser] = yield* db
								.select({ disabledAt: user.disabledAt })
								.from(user)
								.where(eq(user.id, run.executionUserId))
								.for("share");
							if (executionUser && executionUser.disabledAt !== null) {
								yield* db
									.update(automationRun)
									.set({
										status: "skipped",
										nextAttemptAt: null,
										finishedAt: input.now,
										skipReason: userDisabled,
									})
									.where(eq(automationRun.id, run.id));
								return { attempt: null, claimed: false };
							}
						}
						if (run.attemptCount > 0 && run.artifactsExpireAt <= input.now) {
							yield* db
								.update(automationRun)
								.set({ status: "failed", nextAttemptAt: null, finishedAt: input.now })
								.where(eq(automationRun.id, run.id));
							return { attempt: null, claimed: false };
						}
						const [row] = yield* db
							.insert(table)
							.values({
								...automationAttemptIdentity(input.runId, input.attemptNumber),
								retryable: false,
								status: "running",
								runId: input.runId,
								startedAt: input.now,
								attemptNumber: input.attemptNumber,
							})
							.returning();
						if (!row) {
							return yield* conflict("Automation attempt insert failed");
						}
						yield* db
							.update(automationRun)
							.set({
								finishedAt: null,
								status: "running",
								nextAttemptAt: null,
								attemptCount: input.attemptNumber,
								startedAt: run.startedAt ?? input.now,
							})
							.where(
								and(
									eq(automationRun.id, run.id),
									eq(automationRun.status, "queued"),
									eq(automationRun.attemptCount, run.attemptCount),
								),
							);
						return { claimed: true, attempt: yield* decodeRow(row) };
					}),
				);
			const finalizeAttempt = (input: FinalizeAutomationAttempt, now: Date) =>
				atomic(
					Effect.gen(function* () {
						yield* validateTime(now);
						const run = yield* lockRun(input.runId);
						const attempt = yield* findAttempt(input.runId, input.attemptNumber);
						if (!attempt) {
							return yield* conflict("Automation attempt not found");
						}
						const outcome = {
							...boundAutomationAttemptArtifacts(input),
							timing: input.timing,
							status: input.status,
							failureKind: input.failureKind,
							retryable:
								input.status === "failed" &&
								run.stage !== "before" &&
								isRetryableAutomationFailure(input.failureKind, run.retryPolicy),
						};
						if (attempt.status !== "running") {
							const stored = {
								logs: attempt.logs,
								error: attempt.error,
								timing: attempt.timing,
								status: attempt.status,
								retryable: attempt.retryable,
								failureKind: attempt.failureKind,
								returnedValue: attempt.returnedValue,
							};
							if (
								attempt.artifactsPrunedAt !== null ||
								stableStringify(stored) !== stableStringify(outcome)
							) {
								return yield* conflict("Immutable automation attempt outcome conflict");
							}
							return attempt;
						}
						if (
							run.status !== "running" ||
							run.attemptCount !== input.attemptNumber ||
							now.getTime() < Date.parse(attempt.startedAt)
						) {
							return yield* conflict("Automation attempt finalize conflict");
						}
						const validated = yield* decodeStoredSchema(
							{ ...attempt, ...outcome, finishedAt: now.toISOString() },
							AutomationRunAttempt,
							"Invalid automation attempt outcome",
						);
						const nextAttemptAt =
							input.status === "failed"
								? automaticRetryAt(
										{ ...run, artifactsExpireAt: run.artifactsExpireAt.toISOString() },
										input.failureKind,
										now,
									)
								: null;
						const db = yield* Database;
						yield* db
							.update(table)
							.set({ ...outcome, ...projectAutomationAttemptHistory(outcome), finishedAt: now })
							.where(and(eq(table.id, attempt.id), eq(table.status, "running")));
						const rejected =
							run.stage === "before" &&
							input.status === "succeeded" &&
							input.returnedValue !== null &&
							typeof input.returnedValue === "object" &&
							"action" in input.returnedValue &&
							input.returnedValue["action"] === "reject";
						const terminalStatus = rejected ? "rejected" : input.status;
						yield* db
							.update(automationRun)
							.set({
								nextAttemptAt,
								finishedAt: nextAttemptAt ? null : now,
								status: nextAttemptAt ? "queued" : terminalStatus,
							})
							.where(eq(automationRun.id, run.id));
						return validated;
					}),
				);
			const pruneArtifacts = Effect.fn(function* (input: {
				before: Date;
				prunedAt: Date;
				limit: number;
			}) {
				const db = yield* Database;
				const candidates = db
					.select({ id: table.id })
					.from(table)
					.innerJoin(automationRun, eq(automationRun.id, table.runId))
					.where(
						and(
							isNull(table.artifactsPrunedAt),
							lte(table.startedAt, input.before),
							lte(automationRun.artifactsExpireAt, input.prunedAt),
							notInArray(table.status, ["running"]),
							notInArray(automationRun.status, ["queued", "running"]),
						),
					)
					.orderBy(asc(table.startedAt), asc(table.id))
					.limit(input.limit);
				return yield* mapDatabaseErrors(
					db
						.update(table)
						.set({
							logs: null,
							error: null,
							historyLogs: null,
							historyError: null,
							returnedValue: null,
							historyArtifactsTruncated: false,
							artifactsPrunedAt: input.prunedAt,
						})
						.where(inArray(table.id, candidates))
						.returning({ id: table.id }),
				);
			});
			return {
				queueRetry,
				findAttempt,
				pruneArtifacts,
				finalizeAttempt,
				claimNextAttempt,
				retryEligibility,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
