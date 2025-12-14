import type {
	RecipientSignal,
	SubscriptionRunView,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EntityId,
	SignalId,
	SignalSchemaId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DateTime, Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

const recipientSignalColumns = {
	id: schema.signal.id,
	schemaId: schema.signalSchema.id,
	occurredAt: schema.signal.occurredAt,
	properties: schema.signal.properties,
	schemaSlug: schema.signalSchema.slug,
	schemaName: schema.signalSchema.name,
	subjectEntityId: schema.signal.subjectEntityId,
	createdAt: schema.signalRecipient.signalCreatedAt,
};

type RecipientSignalRow = Pick<
	typeof schema.signal.$inferSelect,
	"id" | "occurredAt" | "properties" | "subjectEntityId"
> & {
	readonly createdAt: (typeof schema.signalRecipient.$inferSelect)["signalCreatedAt"];
	readonly schemaId: (typeof schema.signalSchema.$inferSelect)["id"];
	readonly schemaName: (typeof schema.signalSchema.$inferSelect)["name"];
	readonly schemaSlug: (typeof schema.signalSchema.$inferSelect)["slug"];
};

const toRecipientSignal = (row: RecipientSignalRow): RecipientSignal => ({
	properties: row.properties,
	id: SignalId.make(row.id),
	createdAt: DateTime.unsafeMake(row.createdAt),
	occurredAt: DateTime.unsafeMake(row.occurredAt),
	subjectEntityId: row.subjectEntityId ? EntityId.make(row.subjectEntityId) : null,
	schema: {
		slug: row.schemaSlug,
		name: row.schemaName,
		id: SignalSchemaId.make(row.schemaId),
	},
});

const subscriptionRunColumns = {
	id: schema.subscriptionRun.id,
	logs: schema.subscriptionRun.logs,
	error: schema.subscriptionRun.error,
	value: schema.subscriptionRun.value,
	timing: schema.subscriptionRun.timing,
	ruleId: schema.subscriptionRun.ruleId,
	status: schema.subscriptionRun.status,
	queuedAt: schema.subscriptionRun.queuedAt,
	startedAt: schema.subscriptionRun.startedAt,
	operation: schema.subscriptionRun.operation,
	finishedAt: schema.subscriptionRun.finishedAt,
	skippedReason: schema.subscriptionRun.skippedReason,
	originalRuleId: schema.subscriptionRun.originalRuleId,
};

type SubscriptionRunRow = Pick<
	typeof schema.subscriptionRun.$inferSelect,
	| "error"
	| "finishedAt"
	| "id"
	| "logs"
	| "operation"
	| "originalRuleId"
	| "queuedAt"
	| "ruleId"
	| "skippedReason"
	| "startedAt"
	| "status"
	| "timing"
	| "value"
>;

const toSubscriptionRunView = (row: SubscriptionRunRow): SubscriptionRunView => ({
	logs: row.logs,
	error: row.error,
	status: row.status,
	operation: row.operation,
	value: row.value ?? null,
	timing: row.timing ?? null,
	id: SubscriptionRunId.make(row.id),
	skippedReason: row.skippedReason ?? null,
	queuedAt: DateTime.unsafeMake(row.queuedAt),
	originalRuleId: AutomationRuleId.make(row.originalRuleId),
	ruleId: row.ruleId ? AutomationRuleId.make(row.ruleId) : null,
	startedAt: row.startedAt ? DateTime.unsafeMake(row.startedAt) : null,
	finishedAt: row.finishedAt ? DateTime.unsafeMake(row.finishedAt) : null,
});
export const makeAutomationHistoryRepository = () => {
	const listSignalDispatches = Effect.fn("AutomationsRepository.listSignalDispatches")(function* (
		signalId: SignalId,
	) {
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select({
					userId: schema.user.id,
					signalId: schema.signal.id,
					origin: schema.signal.origin,
					ruleId: schema.automationRule.id,
					createdAt: schema.signal.createdAt,
					occurredAt: schema.signal.occurredAt,
					properties: schema.signal.properties,
					actorUserId: schema.signal.actorUserId,
					correlationId: schema.signal.correlationId,
					signalSchemaName: schema.signalSchema.name,
					signalSchemaSlug: schema.signalSchema.slug,
					signalSchemaId: schema.signal.signalSchemaId,
					automationDepth: schema.signal.automationDepth,
					subjectEntityId: schema.signal.subjectEntityId,
				})
				.from(schema.signalRecipient)
				.innerJoin(schema.signal, eq(schema.signal.id, schema.signalRecipient.signalId))
				.innerJoin(schema.signalSchema, eq(schema.signalSchema.id, schema.signal.signalSchemaId))
				.innerJoin(
					schema.automationRule,
					and(
						eq(schema.automationRule.userId, schema.signalRecipient.userId),
						eq(schema.automationRule.signalSchemaId, schema.signal.signalSchemaId),
						eq(schema.automationRule.kind, "subscription"),
						eq(schema.automationRule.operation, "signal"),
						eq(schema.automationRule.isActive, true),
					),
				)
				.innerJoin(schema.user, eq(schema.user.id, schema.automationRule.userId))
				.where(and(eq(schema.signal.id, signalId), isNull(schema.user.disabledAt))),
		);
		return rows.map((row) =>
			Object.assign(row, {
				userId: UserId.make(row.userId),
				ruleId: AutomationRuleId.make(row.ruleId),
			}),
		);
	});

	const listSignalsForRecipient = Effect.fn("AutomationsRepository.listSignalsForRecipient")(
		function* (input: {
			limit: number;
			userId: UserId;
			signalSchemaId?: SignalSchemaId | undefined;
			cursor?: { t: Date; id: string } | undefined;
		}) {
			const db = yield* CurrentDb;
			const conditions = [eq(schema.signalRecipient.userId, input.userId)];
			if (input.signalSchemaId) {
				conditions.push(eq(schema.signalRecipient.signalSchemaId, input.signalSchemaId));
			}
			if (input.cursor) {
				conditions.push(
					sql`(${schema.signalRecipient.signalCreatedAt}, ${schema.signalRecipient.signalId}) < (${input.cursor.t}, ${input.cursor.id})`,
				);
			}
			const rows = yield* dbEffect(() =>
				db
					.select(recipientSignalColumns)
					.from(schema.signalRecipient)
					.innerJoin(schema.signal, eq(schema.signal.id, schema.signalRecipient.signalId))
					.innerJoin(
						schema.signalSchema,
						eq(schema.signalSchema.id, schema.signalRecipient.signalSchemaId),
					)
					.where(and(...conditions))
					.orderBy(
						desc(schema.signalRecipient.signalCreatedAt),
						desc(schema.signalRecipient.signalId),
					)
					.limit(input.limit),
			);
			return rows.map(toRecipientSignal);
		},
	);

	const getSignalForRecipient = Effect.fn("AutomationsRepository.getSignalForRecipient")(
		function* (input: { userId: UserId; signalId: SignalId }) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select(recipientSignalColumns)
					.from(schema.signalRecipient)
					.innerJoin(schema.signal, eq(schema.signal.id, schema.signalRecipient.signalId))
					.innerJoin(
						schema.signalSchema,
						eq(schema.signalSchema.id, schema.signalRecipient.signalSchemaId),
					)
					.where(
						and(
							eq(schema.signalRecipient.userId, input.userId),
							eq(schema.signalRecipient.signalId, input.signalId),
						),
					)
					.limit(1),
			);
			return row ? toRecipientSignal(row) : null;
		},
	);

	const listSubscriptionRunsForUser = Effect.fn(
		"AutomationsRepository.listSubscriptionRunsForUser",
	)(function* (input: {
		limit: number;
		userId: UserId;
		ruleId?: AutomationRuleId | undefined;
		cursor?: { t: Date; id: string } | undefined;
		status?: SubscriptionRunRow["status"] | undefined;
	}) {
		const db = yield* CurrentDb;
		const conditions = [eq(schema.subscriptionRun.executionUserId, input.userId)];
		if (input.ruleId) {
			conditions.push(eq(schema.subscriptionRun.originalRuleId, input.ruleId));
		}
		if (input.status) {
			conditions.push(eq(schema.subscriptionRun.status, input.status));
		}
		if (input.cursor) {
			conditions.push(
				sql`(${schema.subscriptionRun.queuedAt}, ${schema.subscriptionRun.id}) < (${input.cursor.t}, ${input.cursor.id})`,
			);
		}
		const rows = yield* dbEffect(() =>
			db
				.select(subscriptionRunColumns)
				.from(schema.subscriptionRun)
				.where(and(...conditions))
				.orderBy(desc(schema.subscriptionRun.queuedAt), desc(schema.subscriptionRun.id))
				.limit(input.limit),
		);
		return rows.map(toSubscriptionRunView);
	});

	const getSubscriptionRunForUser = Effect.fn("AutomationsRepository.getSubscriptionRunForUser")(
		function* (input: { userId: UserId; runId: SubscriptionRunId }) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select(subscriptionRunColumns)
					.from(schema.subscriptionRun)
					.where(
						and(
							eq(schema.subscriptionRun.executionUserId, input.userId),
							eq(schema.subscriptionRun.id, input.runId),
						),
					)
					.limit(1),
			);
			return row ? toSubscriptionRunView(row) : null;
		},
	);

	return {
		listSignalDispatches,
		getSignalForRecipient,
		listSignalsForRecipient,
		getSubscriptionRunForUser,
		listSubscriptionRunsForUser,
	};
};
