import { DbError } from "@ryot/contract/errors";
import {
	AutomationOperation,
	AutomationRuleKind,
	AutomationRuleMetadata,
	type AutomationOperation as AutomationOperationValue,
	type AutomationRuleKind as AutomationRuleKindValue,
	type AutomationRuleMetadata as AutomationRuleMetadataValue,
	type SubscriptionRunSourceKind,
	type SubscriptionRunSkipReason,
	type SubscriptionRunTiming,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
	SignalId,
	SignalSchemaId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { and, asc, eq, isNull, or, type SQL } from "drizzle-orm";
import { DateTime, Effect, Schema } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type AutomationRuleRow = typeof schema.automationRule.$inferSelect;
type SubscriptionRunRow = typeof schema.subscriptionRun.$inferSelect;

export type AutomationRuleTarget =
	| { kind: "event_schema"; id: EventSchemaId }
	| { kind: "entity_schema"; id: EntitySchemaId }
	| { kind: "signal_schema"; id: SignalSchemaId }
	| { kind: "relationship_schema"; id: RelationshipSchemaId };

export type AutomationReferenceScope = {
	isBuiltin: boolean;
	userId: UserId | null;
};

export type StoredAutomationRule = {
	name: string;
	createdAt: string;
	updatedAt: string;
	isActive: boolean;
	isBuiltin: boolean;
	id: AutomationRuleId;
	userId: UserId | null;
	position: number | null;
	target: AutomationRuleTarget;
	kind: AutomationRuleKindValue;
	sandboxScriptId: SandboxScriptId;
	operation: AutomationOperationValue;
	metadata: AutomationRuleMetadataValue | null;
};

export type InsertAutomationRuleInput = Omit<
	StoredAutomationRule,
	"createdAt" | "id" | "updatedAt"
>;

export type InsertSubscriptionRunInput = {
	ruleName: string;
	occurrenceId: string;
	id: SubscriptionRunId;
	recordId: string | null;
	ruleId: AutomationRuleId;
	signalId: SignalId | null;
	executionUserId: UserId | null;
	sandboxScriptId: SandboxScriptId;
	operation: AutomationOperationValue;
	sourceKind: SubscriptionRunSourceKind;
	ruleMetadata: AutomationRuleMetadataValue | null;
};

export type FinishSubscriptionRunInput = {
	id: SubscriptionRunId;
	status: "failed" | "succeeded";
	timing: SubscriptionRunTiming | null;
	logs: AutomationRuleMetadataValue | null;
	sandboxError: AutomationRuleMetadataValue | null;
	returnedValue: AutomationRuleMetadataValue | null;
};

const decodeStored = <A, I>(value: unknown, valueSchema: Schema.Schema<A, I>, message: string) =>
	Schema.decodeUnknown(valueSchema)(value).pipe(Effect.mapError(() => new DbError({ message })));

const targetValues = (target: AutomationRuleTarget) => {
	if (target.kind === "entity_schema") {
		return { entitySchemaId: target.id };
	}
	if (target.kind === "event_schema") {
		return { eventSchemaId: target.id };
	}
	if (target.kind === "relationship_schema") {
		return { relationshipSchemaId: target.id };
	}
	return { signalSchemaId: target.id };
};

const targetClause = (target: AutomationRuleTarget): SQL => {
	if (target.kind === "entity_schema") {
		return eq(schema.automationRule.entitySchemaId, target.id);
	}
	if (target.kind === "event_schema") {
		return eq(schema.automationRule.eventSchemaId, target.id);
	}
	if (target.kind === "relationship_schema") {
		return eq(schema.automationRule.relationshipSchemaId, target.id);
	}
	return eq(schema.automationRule.signalSchemaId, target.id);
};

const targetFromRow = (row: AutomationRuleRow): AutomationRuleTarget | null => {
	if (row.entitySchemaId) {
		return { id: EntitySchemaId.make(row.entitySchemaId), kind: "entity_schema" };
	}
	if (row.eventSchemaId) {
		return { id: EventSchemaId.make(row.eventSchemaId), kind: "event_schema" };
	}
	if (row.relationshipSchemaId) {
		return {
			id: RelationshipSchemaId.make(row.relationshipSchemaId),
			kind: "relationship_schema",
		};
	}
	if (row.signalSchemaId) {
		return { id: SignalSchemaId.make(row.signalSchemaId), kind: "signal_schema" };
	}
	return null;
};

const toStoredRule = Effect.fn(function* (row: AutomationRuleRow) {
	const target = targetFromRow(row);
	if (!target) {
		return yield* new DbError({ message: `Automation rule ${row.id} has no target` });
	}
	const kind = yield* decodeStored(
		row.kind,
		AutomationRuleKind,
		`Invalid kind for automation rule ${row.id}`,
	);
	const operation = yield* decodeStored(
		row.operation,
		AutomationOperation,
		`Invalid operation for automation rule ${row.id}`,
	);
	const metadata =
		row.metadata !== null
			? yield* decodeStored(
					row.metadata,
					AutomationRuleMetadata,
					`Invalid metadata for automation rule ${row.id}`,
				)
			: null;
	return {
		kind,
		target,
		metadata,
		operation,
		name: row.name,
		position: row.position,
		isActive: row.isActive,
		isBuiltin: row.isBuiltin,
		id: AutomationRuleId.make(row.id),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		userId: row.userId ? UserId.make(row.userId) : null,
		sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
	};
});

const toStoredRun = (row: SubscriptionRunRow) => ({
	...row,
	queuedAt: row.queuedAt.toISOString(),
	id: SubscriptionRunId.make(row.id),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
	scriptUpdatedAt: row.scriptUpdatedAt?.toISOString() ?? null,
	originalRuleId: AutomationRuleId.make(row.originalRuleId),
	sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
	signalId: row.signalId ? SignalId.make(row.signalId) : null,
	ruleId: row.ruleId ? AutomationRuleId.make(row.ruleId) : null,
	executionUserId: row.executionUserId ? UserId.make(row.executionUserId) : null,
});

export type StoredSubscriptionRun = ReturnType<typeof toStoredRun>;

export class AutomationsRepository extends Effect.Service<AutomationsRepository>()(
	"AutomationsRepository",
	{
		sync: () => {
			const findTargetScope = Effect.fn("AutomationsRepository.findTargetScope")(function* (
				target: AutomationRuleTarget,
			) {
				const db = yield* CurrentDb;
				const selection = {
					userId: schema.entitySchema.userId,
					isBuiltin: schema.entitySchema.isBuiltin,
				};
				if (target.kind === "entity_schema") {
					const [row] = yield* dbEffect(() =>
						db
							.select(selection)
							.from(schema.entitySchema)
							.where(eq(schema.entitySchema.id, target.id))
							.limit(1),
					);
					return row ? { ...row, userId: row.userId ? UserId.make(row.userId) : null } : null;
				}
				if (target.kind === "event_schema") {
					const [row] = yield* dbEffect(() =>
						db
							.select({
								userId: schema.eventSchema.userId,
								isBuiltin: schema.eventSchema.isBuiltin,
							})
							.from(schema.eventSchema)
							.where(eq(schema.eventSchema.id, target.id))
							.limit(1),
					);
					return row ? { ...row, userId: row.userId ? UserId.make(row.userId) : null } : null;
				}
				if (target.kind === "relationship_schema") {
					const [row] = yield* dbEffect(() =>
						db
							.select({
								userId: schema.relationshipSchema.userId,
								isBuiltin: schema.relationshipSchema.isBuiltin,
							})
							.from(schema.relationshipSchema)
							.where(eq(schema.relationshipSchema.id, target.id))
							.limit(1),
					);
					return row ? { ...row, userId: row.userId ? UserId.make(row.userId) : null } : null;
				}
				const [row] = yield* dbEffect(() =>
					db
						.select({
							userId: schema.signalSchema.userId,
							isBuiltin: schema.signalSchema.isBuiltin,
						})
						.from(schema.signalSchema)
						.where(eq(schema.signalSchema.id, target.id))
						.limit(1),
				);
				return row ? { ...row, userId: row.userId ? UserId.make(row.userId) : null } : null;
			});

			const findScriptScope = Effect.fn("AutomationsRepository.findScriptScope")(function* (
				scriptId: SandboxScriptId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							userId: schema.sandboxScript.userId,
							isBuiltin: schema.sandboxScript.isBuiltin,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				return row ? { ...row, userId: row.userId ? UserId.make(row.userId) : null } : null;
			});

			const findScriptExecution = Effect.fn("AutomationsRepository.findScriptExecution")(function* (
				scriptId: SandboxScriptId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							userId: schema.sandboxScript.userId,
							updatedAt: schema.sandboxScript.updatedAt,
							isBuiltin: schema.sandboxScript.isBuiltin,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				return row
					? {
							isBuiltin: row.isBuiltin,
							updatedAt: row.updatedAt.toISOString(),
							userId: row.userId ? UserId.make(row.userId) : null,
						}
					: null;
			});

			const findByUnique = Effect.fn("AutomationsRepository.findByUnique")(function* (input: {
				userId: UserId | null;
				target: AutomationRuleTarget;
				sandboxScriptId: SandboxScriptId;
				operation: AutomationOperationValue;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.automationRule)
						.where(
							and(
								input.userId
									? eq(schema.automationRule.userId, input.userId)
									: isNull(schema.automationRule.userId),
								targetClause(input.target),
								eq(schema.automationRule.operation, input.operation),
								eq(schema.automationRule.sandboxScriptId, input.sandboxScriptId),
							),
						)
						.limit(1),
				);
				return row ? yield* toStoredRule(row) : null;
			});

			const insertRule = Effect.fn("AutomationsRepository.insertRule")(function* (
				input: InsertAutomationRuleInput,
			) {
				const db = yield* CurrentDb;
				const { target, ...values } = input;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.automationRule)
						.values({ ...values, ...targetValues(target) })
						.onConflictDoNothing()
						.returning(),
				);
				return row ? yield* toStoredRule(row) : null;
			});

			const updateBuiltin = Effect.fn("AutomationsRepository.updateBuiltin")(function* (input: {
				name: string;
				isActive: boolean;
				id: AutomationRuleId;
				position: number | null;
				kind: AutomationRuleKindValue;
				metadata: AutomationRuleMetadataValue | null;
			}) {
				const db = yield* CurrentDb;
				const { id, ...fields } = input;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.automationRule)
						.set({ ...fields, isBuiltin: true })
						.where(eq(schema.automationRule.id, id))
						.returning(),
				);
				if (!row) {
					return yield* new DbError({ message: "Automation rule update returned no row" });
				}
				return yield* toStoredRule(row);
			});

			const resolveActive = Effect.fn("AutomationsRepository.resolveActive")(function* (input: {
				rowUserId: UserId | null;
				target: AutomationRuleTarget;
				operation: AutomationOperationValue;
			}) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.automationRule)
						.where(
							and(
								eq(schema.automationRule.isActive, true),
								eq(schema.automationRule.kind, "subscription"),
								targetClause(input.target),
								eq(schema.automationRule.operation, input.operation),
								input.rowUserId
									? or(
											eq(schema.automationRule.userId, input.rowUserId),
											and(
												isNull(schema.automationRule.userId),
												eq(schema.automationRule.isBuiltin, true),
											),
										)
									: and(
											isNull(schema.automationRule.userId),
											eq(schema.automationRule.isBuiltin, true),
										),
							),
						)
						.orderBy(asc(schema.automationRule.position), asc(schema.automationRule.id)),
				);
				return yield* Effect.all(rows.map(toStoredRule));
			});

			const isUserEnabled = Effect.fn("AutomationsRepository.isUserEnabled")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.user.id })
						.from(schema.user)
						.where(and(eq(schema.user.id, userId), isNull(schema.user.disabledAt)))
						.limit(1),
				);
				return row !== undefined;
			});

			const lockActiveSubscription = Effect.fn("AutomationsRepository.lockActiveSubscription")(
				function* (ruleId: AutomationRuleId) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.automationRule)
							.where(
								and(
									eq(schema.automationRule.id, ruleId),
									eq(schema.automationRule.isActive, true),
									eq(schema.automationRule.kind, "subscription"),
								),
							)
							.limit(1)
							.for("update"),
					);
					return row ? yield* toStoredRule(row) : null;
				},
			);

			const insertRun = Effect.fn("AutomationsRepository.insertRun")(function* (
				input: InsertSubscriptionRunInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.subscriptionRun)
						.values({ ...input, originalRuleId: input.ruleId })
						.onConflictDoNothing({ target: schema.subscriptionRun.id })
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const findRunById = Effect.fn("AutomationsRepository.findRunById")(function* (
				id: SubscriptionRunId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.subscriptionRun)
						.where(eq(schema.subscriptionRun.id, id))
						.limit(1),
				);
				return row ? toStoredRun(row) : null;
			});

			const markRunRunning = Effect.fn("AutomationsRepository.markRunRunning")(function* (input: {
				id: SubscriptionRunId;
				scriptUpdatedAt: Date;
			}) {
				const db = yield* CurrentDb;
				const startedAt = yield* DateTime.nowAsDate;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.subscriptionRun)
						.set({
							startedAt,
							status: "running",
							scriptUpdatedAt: input.scriptUpdatedAt,
						})
						.where(
							and(
								eq(schema.subscriptionRun.id, input.id),
								eq(schema.subscriptionRun.status, "queued"),
							),
						)
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const finishRun = Effect.fn("AutomationsRepository.finishRun")(function* (
				input: FinishSubscriptionRunInput,
			) {
				const db = yield* CurrentDb;
				const finishedAt = yield* DateTime.nowAsDate;
				const { id, ...outcome } = input;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.subscriptionRun)
						.set({ ...outcome, finishedAt })
						.where(
							and(eq(schema.subscriptionRun.id, id), eq(schema.subscriptionRun.status, "running")),
						)
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const skipRun = Effect.fn("AutomationsRepository.skipRun")(function* (input: {
				id: SubscriptionRunId;
				reason: SubscriptionRunSkipReason;
			}) {
				const db = yield* CurrentDb;
				const now = yield* DateTime.nowAsDate;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.subscriptionRun)
						.set({ status: "skipped", startedAt: now, finishedAt: now, skipReason: input.reason })
						.where(
							and(
								eq(schema.subscriptionRun.id, input.id),
								eq(schema.subscriptionRun.status, "queued"),
							),
						)
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const listRunsByOriginalRuleId = Effect.fn("AutomationsRepository.listRunsByOriginalRuleId")(
				function* (input: { userId: UserId; originalRuleId: AutomationRuleId }) {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select()
							.from(schema.subscriptionRun)
							.where(
								and(
									eq(schema.subscriptionRun.originalRuleId, input.originalRuleId),
									eq(schema.subscriptionRun.executionUserId, input.userId),
								),
							)
							.orderBy(asc(schema.subscriptionRun.queuedAt), asc(schema.subscriptionRun.id)),
					);
					return rows.map(toStoredRun);
				},
			);

			const setUserRuleActive = Effect.fn("AutomationsRepository.setUserRuleActive")(
				function* (input: { userId: UserId; ruleId: AutomationRuleId; isActive: boolean }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.update(schema.automationRule)
							.set({ isActive: input.isActive })
							.where(
								and(
									eq(schema.automationRule.id, input.ruleId),
									eq(schema.automationRule.userId, input.userId),
									eq(schema.automationRule.isBuiltin, false),
								),
							)
							.returning(),
					);
					return row ? yield* toStoredRule(row) : null;
				},
			);

			const deleteUserRule = Effect.fn("AutomationsRepository.deleteUserRule")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.delete(schema.automationRule)
						.where(
							and(
								eq(schema.automationRule.id, input.ruleId),
								eq(schema.automationRule.userId, input.userId),
								eq(schema.automationRule.isBuiltin, false),
							),
						)
						.returning({ id: schema.automationRule.id }),
				);
				return row ? { id: AutomationRuleId.make(row.id) } : null;
			});

			return {
				skipRun,
				finishRun,
				insertRun,
				insertRule,
				findRunById,
				findByUnique,
				resolveActive,
				updateBuiltin,
				isUserEnabled,
				deleteUserRule,
				findScriptScope,
				markRunRunning,
				findTargetScope,
				setUserRuleActive,
				findScriptExecution,
				lockActiveSubscription,
				listRunsByOriginalRuleId,
			};
		},
	},
) {}
