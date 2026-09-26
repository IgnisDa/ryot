import { Option, Result } from "effect";
import { expect, it } from "vitest";

import { automationHistoryRunRecipe, automationHistoryRunsRecipe } from "./automation-history";
import { requireRowsQuery, rowsResult } from "./test-utils";

const date = "2026-09-23T10:00:00+02:00";
const page = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 2, hasMore: false, nextCursor: null });
const runColumn = (field: string) => ({ field, type: "column", tableAlias: "run" });
const equality = (field: string, value: string) => ({
	operator: "eq",
	type: "comparison",
	left: runColumn(field),
	right: { value, type: "literal" },
});
const dateBound = (operator: string, value: string) => ({
	operator,
	type: "comparison",
	left: runColumn("queuedAt"),
	right: { type: "cast", target: "date", expr: { value, type: "literal" } },
});

const run = {
	id: "run",
	queuedAt: date,
	stage: "after",
	pluginId: null,
	startedAt: null,
	attemptCount: 1,
	finishedAt: null,
	status: "failed",
	hookSlug: "hook",
	hookName: "Hook",
	pluginName: null,
	skipReason: null,
	delivery: "async",
	nextAttemptAt: null,
	triggerId: "trigger",
	executionUserId: null,
	pluginRevisionId: null,
	artifactsExpireAt: date,
	triggerKind: { operation: "emit", category: "signal", resource: "signal" },
};

it("builds concrete automation filters and omits absent filters", () => {
	const query = requireRowsQuery(
		automationHistoryRunsRecipe({
			limit: 5,
			hookSlug: "h",
			pluginId: "p",
			stage: "after",
			triggerId: "t",
			status: "failed",
			to: "2026-09-24",
			from: "2026-09-20",
		}).document.queries.runs,
	);
	expect(query.where).toEqual({
		type: "and",
		predicates: [
			equality("status", "failed"),
			equality("stage", "after"),
			equality("pluginId", "p"),
			equality("hookSlug", "h"),
			equality("triggerId", "t"),
			dateBound("gte", "2026-09-20"),
			dateBound("lte", "2026-09-24"),
		],
	});
	expect(query.output.pagination).toEqual({ limit: 5 });
	expect(
		requireRowsQuery(automationHistoryRunsRecipe({ limit: 5 }).document.queries.runs).where,
	).toBeUndefined();
});

it("maps projected automation payload and attempt artifacts", () => {
	const decoded = Result.getOrThrow(
		automationHistoryRunRecipe({ id: "run" }).decode({
			data: {
				run: page([
					{
						...run,
						historyPayloadTruncated: true,
						historyPayload: { payload: "redacted" },
						retryEligibility: { reason: "expired" },
						triggers: {
							pageInfo: { limit: 1, hasMore: false },
							items: [
								{ id: "trigger", occurredAt: date, kind: run.triggerKind, payloadPrunedAt: null },
							],
						},
						attempts: {
							pageInfo: { limit: 50, hasMore: true },
							items: [
								{
									logs: null,
									runId: "run",
									timing: null,
									id: "attempt",
									startedAt: date,
									attemptNumber: 1,
									status: "failed",
									finishedAt: date,
									retryable: false,
									artifactsPrunedAt: null,
									artifactsTruncated: true,
									failureKind: "business-failure",
									error: { code: "failed", message: "redacted" },
								},
							],
						},
					},
				]),
			},
		}),
	);
	expect(Option.isSome(decoded)).toBe(true);
	if (Option.isSome(decoded)) {
		expect(decoded.value.trigger).toMatchObject({
			payloadTruncated: true,
			payload: { payload: "redacted" },
		});
		expect(decoded.value.attemptsTruncated).toBe(true);
		expect(decoded.value.attempts[0]).toMatchObject({
			artifactsTruncated: true,
			error: { code: "failed" },
		});
		expect(decoded.value.run).not.toHaveProperty("triggers");
	}
	expect(
		Option.isNone(
			Result.getOrThrow(
				automationHistoryRunRecipe({ id: "absent" }).decode({ data: { run: page([]) } }),
			),
		),
	).toBe(true);
});
