import {
	AUTOMATION_HISTORY_LIMITS,
	AutomationHistoryAttempt,
	AutomationHistoryRun,
	AutomationRetryEligibility,
} from "@ryot-app/contract/modules/automations/history-schemas";
import {
	AutomationRunStatus,
	AutomationTriggerKind,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	castDate,
	column,
	defineRecipe,
	descending,
	eq,
	gte,
	literal,
	lte,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Option, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const run = table("automationRun", "run");
const trigger = table("automationTrigger", "trigger");
const attempt = table("automationRunAttempt", "attempt");
const runSelection = {
	queuedAt: selectedField(column(run, "queuedAt"), IsoDateString),
	status: selectedField(column(run, "status"), AutomationRunStatus),
	id: selectedField(column(run, "id"), AutomationHistoryRun.fields.id),
	stage: selectedField(column(run, "stage"), AutomationHistoryRun.fields.stage),
	triggerKind: selectedField(column(run, "triggerKind"), AutomationTriggerKind),
	startedAt: selectedField(column(run, "startedAt"), Schema.NullOr(IsoDateString)),
	artifactsExpireAt: selectedField(column(run, "artifactsExpireAt"), IsoDateString),
	finishedAt: selectedField(column(run, "finishedAt"), Schema.NullOr(IsoDateString)),
	delivery: selectedField(column(run, "delivery"), AutomationHistoryRun.fields.delivery),
	pluginId: selectedField(column(run, "pluginId"), AutomationHistoryRun.fields.pluginId),
	hookSlug: selectedField(column(run, "hookSlug"), AutomationHistoryRun.fields.hookSlug),
	hookName: selectedField(column(run, "hookName"), AutomationHistoryRun.fields.hookName),
	nextAttemptAt: selectedField(column(run, "nextAttemptAt"), Schema.NullOr(IsoDateString)),
	triggerId: selectedField(column(run, "triggerId"), AutomationHistoryRun.fields.triggerId),
	pluginName: selectedField(column(run, "pluginName"), AutomationHistoryRun.fields.pluginName),
	skipReason: selectedField(column(run, "skipReason"), AutomationHistoryRun.fields.skipReason),
	attemptCount: selectedField(
		column(run, "attemptCount"),
		AutomationHistoryRun.fields.attemptCount,
	),
	executionUserId: selectedField(
		column(run, "executionUserId"),
		AutomationHistoryRun.fields.executionUserId,
	),
	pluginRevisionId: selectedField(
		column(run, "pluginRevisionId"),
		AutomationHistoryRun.fields.pluginRevisionId,
	),
};

export const automationHistoryRunsRecipe = defineRecipe(
	(input: {
		readonly after?: string;
		readonly limit: number;
		readonly status?: AutomationRunStatus;
		readonly stage?: "before" | "after";
		readonly pluginId?: string;
		readonly hookSlug?: string;
		readonly triggerId?: string;
		readonly from?: string;
		readonly to?: string;
	}) => {
		const filters = [
			...(input.status === undefined ? [] : [eq(column(run, "status"), literal(input.status))]),
			...(input.stage === undefined ? [] : [eq(column(run, "stage"), literal(input.stage))]),
			...(input.pluginId === undefined
				? []
				: [eq(column(run, "pluginId"), literal(input.pluginId))]),
			...(input.hookSlug === undefined
				? []
				: [eq(column(run, "hookSlug"), literal(input.hookSlug))]),
			...(input.triggerId === undefined
				? []
				: [eq(column(run, "triggerId"), literal(input.triggerId))]),
			...(input.from === undefined
				? []
				: [gte(column(run, "queuedAt"), castDate(literal(input.from)))]),
			...(input.to === undefined
				? []
				: [lte(column(run, "queuedAt"), castDate(literal(input.to)))]),
		];
		return {
			map: ({ runs }) => Result.succeed(runs),
			queries: {
				runs: selectedRows(run, {
					after: input.after,
					limit: input.limit,
					selection: runSelection,
					where: filters.length ? and(...filters) : undefined,
					orderBy: [descending(column(run, "queuedAt")), descending(column(run, "id"))],
				}),
			},
		};
	},
);

export const automationHistoryRunRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ run: item }) => {
		if (item === undefined) {
			return Result.succeed(Option.none());
		}
		const triggerItem = item.triggers.items[0];
		if (triggerItem === undefined) {
			return Result.fail(new Error("Automation run is missing its trigger"));
		}
		const {
			attempts,
			historyPayload,
			retryEligibility,
			triggers: _triggers,
			historyPayloadTruncated,
			...summary
		} = item;
		return Result.succeed(
			Option.some({
				run: summary,
				retryEligibility,
				attempts: attempts.items,
				attemptsTruncated: attempts.pageInfo.hasMore,
				trigger: {
					...triggerItem,
					payload: historyPayload,
					payloadTruncated: historyPayloadTruncated,
				},
			}),
		);
	},
	queries: {
		run: selectedOptionalRow(run, {
			orderBy: [ascending(column(run, "id"))],
			where: eq(column(run, "id"), literal(input.id)),
			selection: {
				...runSelection,
				historyPayload: selectedField(column(run, "historyPayload"), Schema.NullOr(JsonValue)),
				retryEligibility: selectedField(
					column(run, "retryEligibility"),
					AutomationRetryEligibility,
				),
				historyPayloadTruncated: selectedField(
					column(run, "historyPayloadTruncated"),
					Schema.Boolean,
				),
			},
			include: {
				triggers: selectedInclude(trigger, {
					limit: 1,
					orderBy: [ascending(column(trigger, "id"))],
					where: eq(column(trigger, "id"), column(run, "triggerId")),
					selection: {
						kind: selectedField(column(trigger, "kind"), AutomationTriggerKind),
						occurredAt: selectedField(column(trigger, "occurredAt"), IsoDateString),
						id: selectedField(column(trigger, "id"), AutomationHistoryRun.fields.triggerId),
						payloadPrunedAt: selectedField(
							column(trigger, "payloadPrunedAt"),
							Schema.NullOr(IsoDateString),
						),
					},
				}),
				attempts: selectedInclude(attempt, {
					limit: AUTOMATION_HISTORY_LIMITS.maxAttempts,
					where: eq(column(attempt, "runId"), column(run, "id")),
					orderBy: [ascending(column(attempt, "attemptNumber")), ascending(column(attempt, "id"))],
					selection: {
						startedAt: selectedField(column(attempt, "startedAt"), IsoDateString),
						retryable: selectedField(column(attempt, "retryable"), Schema.Boolean),
						id: selectedField(column(attempt, "id"), AutomationHistoryAttempt.fields.id),
						runId: selectedField(column(attempt, "runId"), AutomationHistoryAttempt.fields.runId),
						finishedAt: selectedField(column(attempt, "finishedAt"), Schema.NullOr(IsoDateString)),
						status: selectedField(
							column(attempt, "status"),
							AutomationHistoryAttempt.fields.status,
						),
						timing: selectedField(
							column(attempt, "timing"),
							AutomationHistoryAttempt.fields.timing,
						),
						logs: selectedField(
							column(attempt, "historyLogs"),
							AutomationHistoryAttempt.fields.logs,
						),
						error: selectedField(
							column(attempt, "historyError"),
							AutomationHistoryAttempt.fields.error,
						),
						artifactsTruncated: selectedField(
							column(attempt, "historyArtifactsTruncated"),
							Schema.Boolean,
						),
						artifactsPrunedAt: selectedField(
							column(attempt, "artifactsPrunedAt"),
							Schema.NullOr(IsoDateString),
						),
						failureKind: selectedField(
							column(attempt, "failureKind"),
							AutomationHistoryAttempt.fields.failureKind,
						),
						attemptNumber: selectedField(
							column(attempt, "attemptNumber"),
							AutomationHistoryAttempt.fields.attemptNumber,
						),
					},
				}),
			},
		}),
	},
}));

export type AutomationHistoryRunsPage = Recipe.Success<typeof automationHistoryRunsRecipe>;
export type AutomationHistoryRunDetail = Recipe.Success<typeof automationHistoryRunRecipe>;
