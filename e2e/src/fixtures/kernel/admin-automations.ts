import {
	AutomationRun as AutomationRunSchema,
	AutomationRunAttempt as AutomationRunAttemptSchema,
	AutomationTrigger as AutomationTriggerSchema,
	AutomationTriggerRecipient,
	type AutomationEntitySnapshot,
	type AutomationEventSnapshot,
	type AutomationRelationshipSnapshot,
	type AutomationTrigger,
	type AutomationTriggerPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	and,
	ascending,
	castText,
	coalesce,
	column,
	defineRecipe,
	descending,
	eq,
	exists,
	isNull,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const trigger = table("automationTrigger", "trigger");
const run = table("automationRun", "run");
const attempt = table("automationRunAttempt", "attempt");
const recipient = table("automationTriggerRecipient", "recipient");

export type AutomationTriggerFilter = {
	readonly triggerId?: AutomationTrigger["id"];
	readonly payload?: NonNullable<AutomationTrigger["payload"]>;
	readonly rootExecutionId?: AutomationTrigger["causation"]["rootExecutionId"];
	readonly sourceRecord?:
		| { readonly id: AutomationEntitySnapshot["id"]; readonly resource: "entity" }
		| { readonly id: AutomationEventSnapshot["id"]; readonly resource: "event" }
		| { readonly id: AutomationRelationshipSnapshot["id"]; readonly resource: "relationship" }
		| {
				readonly id: Extract<
					AutomationTriggerPayload,
					{ readonly resource: "provider-entity-import" }
				>["entityId"];
				readonly resource: "provider-entity-import";
		  };
};

export type AutomationRunFilter = AutomationTriggerFilter & {
	readonly status?: typeof AutomationRunSchema.Type.status;
	readonly hookSlug?: typeof AutomationRunSchema.Type.hookSlug;
	readonly executionUserId?: typeof AutomationRunSchema.Type.executionUserId;
};

export type AutomationRunAttemptFilter = {
	readonly runId: typeof AutomationRunAttemptSchema.Type.runId;
	readonly status?: typeof AutomationRunAttemptSchema.Type.status;
};

export type AutomationTriggerRecipientFilter = {
	readonly triggerId: typeof AutomationTriggerRecipient.Type.triggerId;
	readonly userId?: typeof AutomationTriggerRecipient.Type.userId;
};

const triggerFilters = (input: AutomationTriggerFilter) => {
	const sourceId =
		input.sourceRecord?.resource === "provider-entity-import"
			? castText(jsonPath(column(trigger, "payload"), "entityId"))
			: coalesce(
					castText(jsonPath(column(trigger, "payload"), "after", "id")),
					castText(jsonPath(column(trigger, "payload"), "before", "id")),
				);
	return [
		...(input.triggerId === undefined ? [] : [eq(column(trigger, "id"), literal(input.triggerId))]),
		...(input.rootExecutionId === undefined
			? []
			: [eq(column(trigger, "rootExecutionId"), literal(input.rootExecutionId))]),
		...(input.payload === undefined
			? []
			: [eq(column(trigger, "payload"), literal(input.payload))]),
		...(input.sourceRecord === undefined
			? []
			: [
					eq(column(trigger, "resourceKind"), literal(input.sourceRecord.resource)),
					eq(sourceId, literal(input.sourceRecord.id)),
				]),
	];
};

const selected = (reference: ReturnType<typeof table>, names: readonly string[]) =>
	Object.fromEntries(
		names.map((name) => [name, selectedField(column(reference, name), Schema.Unknown)]),
	);

export const adminAutomationTriggersRecipe = defineRecipe(
	(input: AutomationTriggerFilter & { readonly after?: string }) => {
		const filters = triggerFilters(input);
		return {
			queries: {
				triggers: selectedRows(trigger, {
					limit: 100,
					after: input.after,
					where: filters.length ? and(...filters) : undefined,
					orderBy: [descending(column(trigger, "createdAt")), descending(column(trigger, "id"))],
					selection: selected(trigger, [
						"id",
						"kind",
						"createdAt",
						"occurredAt",
						"payload",
						"scopeUserId",
						"blockedReason",
						"payloadPrunedAt",
						"depth",
						"source",
						"executionId",
						"rootExecutionId",
						"parentRunId",
						"parentTriggerId",
						"initiatorId",
						"initiatorKind",
						"importRunId",
						"integrationId",
						"providerExecutionId",
					]),
				}),
			},
			map: ({ triggers }) =>
				Result.map(
					Result.all(
						triggers.items.map((item) =>
							Schema.decodeUnknownResult(AutomationTriggerSchema)({
								id: item.id,
								kind: item.kind,
								payload: item.payload,
								createdAt: item.createdAt,
								occurredAt: item.occurredAt,
								scopeUserId: item.scopeUserId,
								blockedReason: item.blockedReason,
								payloadPrunedAt: item.payloadPrunedAt,
								causation: {
									depth: item.depth,
									source: item.source,
									initiator: { id: item.initiatorId, kind: item.initiatorKind },
									...(item.importRunId === null ? {} : { importRunId: item.importRunId }),
									...(item.integrationId === null ? {} : { integrationId: item.integrationId }),
									...(item.providerExecutionId === null
										? {}
										: { providerExecutionId: item.providerExecutionId }),
									parentRunId: item.parentRunId,
									executionId: item.executionId,
									parentTriggerId: item.parentTriggerId,
									rootExecutionId: item.rootExecutionId,
								},
							}),
						),
					),
					(items) => ({ items, pageInfo: triggers.pageInfo }),
				),
		};
	},
);

export const adminAutomationRecipientsRecipe = defineRecipe(
	(input: AutomationTriggerRecipientFilter & { readonly after?: string }) => ({
		map: ({ recipients }) => Result.succeed(recipients),
		queries: {
			recipients: selectedRows(recipient, {
				limit: 100,
				after: input.after,
				orderBy: [ascending(column(recipient, "userId"))],
				where: and(
					eq(column(recipient, "triggerId"), literal(input.triggerId)),
					...(input.userId === undefined
						? []
						: [eq(column(recipient, "userId"), literal(input.userId))]),
				),
				selection: {
					userId: selectedField(
						column(recipient, "userId"),
						AutomationTriggerRecipient.fields.userId,
					),
					triggerId: selectedField(
						column(recipient, "triggerId"),
						AutomationTriggerRecipient.fields.triggerId,
					),
				},
			}),
		},
	}),
);

export const adminAutomationRunsRecipe = defineRecipe(
	(input: AutomationRunFilter & { readonly after?: string }) => {
		const filters = triggerFilters(input);
		let userFilter;
		if (input.executionUserId === null) {
			userFilter = isNull(column(run, "executionUserId"));
		} else if (input.executionUserId !== undefined) {
			userFilter = eq(column(run, "executionUserId"), literal(input.executionUserId));
		}
		return {
			map: ({ runs }) =>
				Result.map(
					Result.all(
						runs.items.map((item) => Schema.decodeUnknownResult(AutomationRunSchema)(item)),
					),
					(items) => ({ items, pageInfo: runs.pageInfo }),
				),
			queries: {
				runs: selectedRows(run, {
					limit: 100,
					after: input.after,
					orderBy: [descending(column(run, "queuedAt")), descending(column(run, "id"))],
					where: and(
						...(filters.length
							? [
									exists(trigger, {
										where: and(eq(column(trigger, "id"), column(run, "triggerId")), ...filters),
									}),
								]
							: []),
						...(input.hookSlug === undefined
							? []
							: [eq(column(run, "hookSlug"), literal(input.hookSlug))]),
						...(input.status === undefined
							? []
							: [eq(column(run, "status"), literal(input.status))]),
						...(userFilter === undefined ? [] : [userFilter]),
					),
					selection: selected(run, [
						"id",
						"stage",
						"pluginId",
						"status",
						"startedAt",
						"skipReason",
						"finishedAt",
						"delivery",
						"hookSlug",
						"hookName",
						"queuedAt",
						"triggerId",
						"nextAttemptAt",
						"executionUserId",
						"pluginRevisionId",
						"attemptCount",
						"artifactsExpireAt",
						"retryPolicy",
						"scriptSlug",
						"sandboxScriptId",
						"scriptContentHash",
						"pluginConfigRevisionId",
					]),
				}),
			},
		};
	},
);

export const adminAutomationAttemptsRecipe = defineRecipe(
	(input: AutomationRunAttemptFilter & { readonly after?: string }) => ({
		map: ({ attempts }) => Result.succeed(attempts),
		queries: {
			attempts: selectedRows(attempt, {
				limit: 100,
				after: input.after,
				orderBy: [ascending(column(attempt, "attemptNumber")), ascending(column(attempt, "id"))],
				where: and(
					eq(column(attempt, "runId"), literal(input.runId)),
					...(input.status === undefined
						? []
						: [eq(column(attempt, "status"), literal(input.status))]),
				),
				selection: {
					id: selectedField(column(attempt, "id"), AutomationRunAttemptSchema.fields.id),
					logs: selectedField(column(attempt, "logs"), AutomationRunAttemptSchema.fields.logs),
					runId: selectedField(column(attempt, "runId"), AutomationRunAttemptSchema.fields.runId),
					error: selectedField(column(attempt, "error"), AutomationRunAttemptSchema.fields.error),
					status: selectedField(
						column(attempt, "status"),
						AutomationRunAttemptSchema.fields.status,
					),
					timing: selectedField(
						column(attempt, "timing"),
						AutomationRunAttemptSchema.fields.timing,
					),
					startedAt: selectedField(
						column(attempt, "startedAt"),
						AutomationRunAttemptSchema.fields.startedAt,
					),
					retryable: selectedField(
						column(attempt, "retryable"),
						AutomationRunAttemptSchema.fields.retryable,
					),
					finishedAt: selectedField(
						column(attempt, "finishedAt"),
						AutomationRunAttemptSchema.fields.finishedAt,
					),
					failureKind: selectedField(
						column(attempt, "failureKind"),
						AutomationRunAttemptSchema.fields.failureKind,
					),
					attemptNumber: selectedField(
						column(attempt, "attemptNumber"),
						AutomationRunAttemptSchema.fields.attemptNumber,
					),
					artifactsPrunedAt: selectedField(
						column(attempt, "artifactsPrunedAt"),
						AutomationRunAttemptSchema.fields.artifactsPrunedAt,
					),
					workflowExecutionId: selectedField(
						column(attempt, "workflowExecutionId"),
						AutomationRunAttemptSchema.fields.workflowExecutionId,
					),
				},
			}),
		},
	}),
);

export type AutomationRun = Recipe.Success<typeof adminAutomationRunsRecipe>["items"][number];
export type AutomationRunAttempt = Recipe.Success<
	typeof adminAutomationAttemptsRecipe
>["items"][number];
