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
import { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import {
	AutomationRuleId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { decodeStoredSchema } from "@ryot/contract/schema/core";
import { and, asc, count, eq, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { DateTime, Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";

type AutomationRuleRow = typeof schema.automationRule.$inferSelect;
type SubscriptionRunRow = typeof schema.subscriptionRun.$inferSelect;

export type AutomationRuleTarget =
	| { kind: "event_schema"; id: EventSchemaSlug }
	| { kind: "entity_schema"; id: EntitySchemaSlug }
	| { kind: "signal_schema"; id: SignalSchemaSlug }
	| { kind: "relationship_schema"; id: RelationshipSchemaSlug };

export type AutomationReferenceScope = {
	isBuiltin: boolean;
	userId: UserId | null;
};

type AutomationScriptScope = AutomationReferenceScope & {
	capabilities: ReadonlyArray<string>;
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

const targetValues = (target: AutomationRuleTarget) => {
	if (target.kind === "entity_schema") {
		return { entitySchemaSlug: target.id };
	}
	if (target.kind === "event_schema") {
		return { eventSchemaSlug: target.id };
	}
	if (target.kind === "relationship_schema") {
		return { relationshipSchemaSlug: target.id };
	}
	return { signalSchemaSlug: target.id };
};

const targetClause = (target: AutomationRuleTarget): SQL => {
	if (target.kind === "entity_schema") {
		return eq(schema.automationRule.entitySchemaSlug, target.id);
	}
	if (target.kind === "event_schema") {
		return eq(schema.automationRule.eventSchemaSlug, target.id);
	}
	if (target.kind === "relationship_schema") {
		return eq(schema.automationRule.relationshipSchemaSlug, target.id);
	}
	return eq(schema.automationRule.signalSchemaSlug, target.id);
};

const userNotificationRuleClause = (input: { userId: UserId; sandboxScriptId: SandboxScriptId }) =>
	and(
		eq(schema.automationRule.userId, input.userId),
		eq(schema.automationRule.kind, "subscription"),
		eq(schema.automationRule.operation, "signal"),
		eq(schema.automationRule.isBuiltin, false),
		isNotNull(schema.automationRule.signalSchemaSlug),
		eq(schema.automationRule.sandboxScriptId, input.sandboxScriptId),
	);

const targetFromRow = (row: AutomationRuleRow): AutomationRuleTarget | null => {
	if (row.entitySchemaSlug) {
		return { id: EntitySchemaSlug.make(row.entitySchemaSlug), kind: "entity_schema" };
	}
	if (row.eventSchemaSlug) {
		return { id: EventSchemaSlug.make(row.eventSchemaSlug), kind: "event_schema" };
	}
	if (row.relationshipSchemaSlug) {
		return {
			id: RelationshipSchemaSlug.make(row.relationshipSchemaSlug),
			kind: "relationship_schema",
		};
	}
	if (row.signalSchemaSlug) {
		return { id: SignalSchemaSlug.make(row.signalSchemaSlug), kind: "signal_schema" };
	}
	return null;
};

const toStoredRule = Effect.fn(function* (row: AutomationRuleRow) {
	const target = targetFromRow(row);
	if (!target) {
		return yield* new DbError({ message: `Automation rule ${row.id} has no target` });
	}
	const kind = yield* decodeStoredSchema(
		row.kind,
		AutomationRuleKind,
		`Invalid kind for automation rule ${row.id}`,
	);
	const operation = yield* decodeStoredSchema(
		row.operation,
		AutomationOperation,
		`Invalid operation for automation rule ${row.id}`,
	);
	const metadata =
		row.metadata !== null
			? yield* decodeStoredSchema(
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
		effect: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const findTargetScope = Effect.fn("AutomationsRepository.findTargetScope")((
				target: AutomationRuleTarget,
			) => {
				let exists: unknown;
				if (target.kind === "entity_schema") {
					exists = definitions.getEntitySchema(target.id);
				} else if (target.kind === "relationship_schema") {
					exists = definitions.getRelationshipSchema(target.id);
				} else if (target.kind === "signal_schema") {
					exists = definitions.getSignalSchema(target.id);
				} else {
					exists = Object.values(definitions.getSnapshot().entitySchemas).find(
						(entity) => entity.eventSchemas[target.id],
					);
				}
				const scope: AutomationReferenceScope | null = exists
					? { userId: null, isBuiltin: true }
					: null;
				return Effect.succeed(scope);
			});

			const findScriptScope = Effect.fn("AutomationsRepository.findScriptScope")(function* (
				scriptId: SandboxScriptId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							userId: schema.sandboxScript.userId,
							metadata: schema.sandboxScript.metadata,
							isBuiltin: schema.sandboxScript.isBuiltin,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				if (!row) {
					return null;
				}
				const metadata = yield* decodeStoredSchema(
					row.metadata,
					SandboxScriptMetadata,
					`Invalid metadata for sandbox script ${scriptId}`,
				);
				return {
					isBuiltin: row.isBuiltin,
					capabilities: metadata.capabilities ?? [],
					userId: row.userId ? UserId.make(row.userId) : null,
				} satisfies AutomationScriptScope;
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

			const findBuiltinScriptBySlug = Effect.fn("AutomationsRepository.findBuiltinScriptBySlug")(
				function* (slug: string) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.sandboxScript.id })
							.from(schema.sandboxScript)
							.where(
								and(
									eq(schema.sandboxScript.slug, slug),
									eq(schema.sandboxScript.isBuiltin, true),
									isNull(schema.sandboxScript.userId),
								),
							)
							.limit(1),
					);
					return row ? { id: SandboxScriptId.make(row.id) } : null;
				},
			);

			const listUserNotificationRules = Effect.fn(
				"AutomationsRepository.listUserNotificationRules",
			)(function* (input: { userId: UserId; sandboxScriptId: SandboxScriptId }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.automationRule)
						.where(userNotificationRuleClause(input))
						.orderBy(asc(schema.automationRule.name), asc(schema.automationRule.id)),
				);
				return yield* Effect.all(rows.map(toStoredRule));
			});

			const countByUser = Effect.fn("AutomationsRepository.countByUser")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ count: count() })
						.from(schema.automationRule)
						.where(eq(schema.automationRule.userId, userId)),
				);
				return row?.count ?? 0;
			});

			const findUserNotificationRule = Effect.fn("AutomationsRepository.findUserNotificationRule")(
				function* (input: {
					userId: UserId;
					ruleId: AutomationRuleId;
					sandboxScriptId: SandboxScriptId;
				}) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.automationRule)
							.where(
								and(eq(schema.automationRule.id, input.ruleId), userNotificationRuleClause(input)),
							)
							.limit(1),
					);
					return row ? yield* toStoredRule(row) : null;
				},
			);

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

			const resolveActiveByKind = Effect.fn("AutomationsRepository.resolveActiveByKind")(
				function* (input: {
					rowUserId: UserId | null;
					target: AutomationRuleTarget;
					kind: AutomationRuleKindValue;
					operation: AutomationOperationValue;
				}) {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select()
							.from(schema.automationRule)
							.where(
								and(
									eq(schema.automationRule.kind, input.kind),
									eq(schema.automationRule.isActive, true),
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
				},
			);

			const resolveActive = Effect.fn("AutomationsRepository.resolveActive")(function* (input: {
				rowUserId: UserId | null;
				target: AutomationRuleTarget;
				operation: AutomationOperationValue;
			}) {
				return yield* resolveActiveByKind({ ...input, kind: "subscription" });
			});

			const resolveActivePolicies = Effect.fn("AutomationsRepository.resolveActivePolicies")(
				function* (input: {
					rowUserId: UserId;
					operation: "create";
					target: AutomationRuleTarget;
				}) {
					return yield* resolveActiveByKind({ ...input, kind: "policy" });
				},
			);

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

			const listRunsByExecutionUserId = Effect.fn(
				"AutomationsRepository.listRunsByExecutionUserId",
			)(function* (input: { executionUserId: UserId; signalId?: SignalId | undefined }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ id: schema.subscriptionRun.id, status: schema.subscriptionRun.status })
						.from(schema.subscriptionRun)
						.where(
							and(
								eq(schema.subscriptionRun.executionUserId, input.executionUserId),
								input.signalId ? eq(schema.subscriptionRun.signalId, input.signalId) : undefined,
							),
						)
						.orderBy(asc(schema.subscriptionRun.queuedAt), asc(schema.subscriptionRun.id)),
				);
				return rows.map((row) => ({ id: SubscriptionRunId.make(row.id), status: row.status }));
			});

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
				countByUser,
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
				resolveActivePolicies,
				lockActiveSubscription,
				findBuiltinScriptBySlug,
				findUserNotificationRule,
				listRunsByExecutionUserId,
				listRunsByOriginalRuleId,
				listUserNotificationRules,
			};
		}),
	},
) {}
