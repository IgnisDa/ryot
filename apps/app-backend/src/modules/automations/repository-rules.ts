import { DbError } from "@ryot/contract/errors";
import type {
	AutomationRuleTarget,
	AutomationRuleView,
	SignalAudiencePolicy,
	UserSignalSchemaView,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
	SignalSchemaId,
	type UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { and, asc, eq } from "drizzle-orm";
import { DateTime, Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, lockUserAndCountOwnedRows } from "#lib/infrastructure/db/service";

type AutomationRuleRow = typeof schema.automationRule.$inferSelect;
type SignalSchemaRow = typeof schema.signalSchema.$inferSelect;

export type LifecycleTargetKind = "entity" | "event" | "relationship";

const ruleTarget = (row: AutomationRuleRow): AutomationRuleTarget | null => {
	if (row.signalSchemaId) {
		return { kind: "signal", id: SignalSchemaId.make(row.signalSchemaId) };
	}
	if (row.eventSchemaId) {
		return { kind: "event", id: EventSchemaId.make(row.eventSchemaId) };
	}
	if (row.relationshipSchemaId) {
		return { kind: "relationship", id: RelationshipSchemaId.make(row.relationshipSchemaId) };
	}
	if (row.entitySchemaId) {
		return { kind: "entity", id: EntitySchemaId.make(row.entitySchemaId) };
	}
	return null;
};

const toRuleView = (row: AutomationRuleRow): AutomationRuleView => {
	const target = ruleTarget(row);
	if (!target) {
		throw new Error(`Automation rule ${row.id} has no target`);
	}
	return {
		target,
		name: row.name,
		kind: row.kind,
		metadata: row.metadata,
		isActive: row.isActive,
		isBuiltin: row.isBuiltin,
		operation: row.operation,
		id: AutomationRuleId.make(row.id),
		createdAt: DateTime.unsafeMake(row.createdAt),
		updatedAt: DateTime.unsafeMake(row.updatedAt),
		sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
	};
};

const toUserSignalSchemaView = (row: SignalSchemaRow): UserSignalSchemaView => ({
	slug: row.slug,
	name: row.name,
	id: SignalSchemaId.make(row.id),
	propertiesSchema: row.propertiesSchema,
	audiencePolicy: row.audiencePolicy,
	createdAt: DateTime.unsafeMake(row.createdAt),
	updatedAt: DateTime.unsafeMake(row.updatedAt),
	archivedAt: row.archivedAt ? DateTime.unsafeMake(row.archivedAt) : null,
});

export const makeAutomationRuleRepository = () => {
	const getUserOwnedScript = Effect.fn("AutomationsRepository.getUserOwnedScript")(
		function* (input: { userId: UserId; scriptId: SandboxScriptId }) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						id: schema.sandboxScript.id,
						metadata: schema.sandboxScript.metadata,
					})
					.from(schema.sandboxScript)
					.where(
						and(
							eq(schema.sandboxScript.id, input.scriptId),
							eq(schema.sandboxScript.userId, input.userId),
						),
					)
					.limit(1),
			);
			return row ? { id: SandboxScriptId.make(row.id), metadata: row.metadata } : null;
		},
	);

	const getLifecycleSchemaVisibility = Effect.fn(
		"AutomationsRepository.getLifecycleSchemaVisibility",
	)(function* (input: { kind: LifecycleTargetKind; schemaId: string }) {
		const db = yield* CurrentDb;
		if (input.kind === "entity") {
			const [row] = yield* dbEffect(() =>
				db
					.select({ userId: schema.entitySchema.userId })
					.from(schema.entitySchema)
					.where(eq(schema.entitySchema.id, input.schemaId))
					.limit(1),
			);
			return row ? { userId: row.userId } : null;
		}
		if (input.kind === "event") {
			const [row] = yield* dbEffect(() =>
				db
					.select({ userId: schema.eventSchema.userId })
					.from(schema.eventSchema)
					.where(eq(schema.eventSchema.id, input.schemaId))
					.limit(1),
			);
			return row ? { userId: row.userId } : null;
		}
		const [row] = yield* dbEffect(() =>
			db
				.select({ userId: schema.relationshipSchema.userId })
				.from(schema.relationshipSchema)
				.where(eq(schema.relationshipSchema.id, input.schemaId))
				.limit(1),
		);
		return row ? { userId: row.userId } : null;
	});

	const insertUserRule = Effect.fn("AutomationsRepository.insertUserRule")(function* (
		values: typeof schema.automationRule.$inferInsert,
	) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.insert(schema.automationRule)
				.values(values)
				.onConflictDoNothing()
				.returning({ id: schema.automationRule.id }),
		);
		return row ? AutomationRuleId.make(row.id) : null;
	});

	const listRulesForUser = Effect.fn("AutomationsRepository.listRulesForUser")(function* (
		userId: UserId,
	) {
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select()
				.from(schema.automationRule)
				.where(eq(schema.automationRule.userId, userId))
				.orderBy(asc(schema.automationRule.createdAt), asc(schema.automationRule.id)),
		);
		return rows.map(toRuleView);
	});

	const getRuleForUser = Effect.fn("AutomationsRepository.getRuleForUser")(function* (input: {
		userId: UserId;
		ruleId: AutomationRuleId;
	}) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.select()
				.from(schema.automationRule)
				.where(
					and(
						eq(schema.automationRule.id, input.ruleId),
						eq(schema.automationRule.userId, input.userId),
					),
				)
				.limit(1),
		);
		return row ? toRuleView(row) : null;
	});

	const updateUserRule = Effect.fn("AutomationsRepository.updateUserRule")(function* (input: {
		userId: UserId;
		ruleId: AutomationRuleId;
		name?: string | undefined;
		isActive?: boolean | undefined;
		metadata?: Record<string, unknown> | undefined;
	}) {
		const db = yield* CurrentDb;
		const patch: Partial<typeof schema.automationRule.$inferInsert> = {};
		if (input.name !== undefined) {
			patch.name = input.name;
		}
		if (input.isActive !== undefined) {
			patch.isActive = input.isActive;
		}
		if (input.metadata !== undefined) {
			patch.metadata = input.metadata;
		}
		if (Object.keys(patch).length === 0) {
			return yield* getRuleForUser(input);
		}
		const [updated] = yield* dbEffect(() =>
			db
				.update(schema.automationRule)
				.set(patch)
				.where(
					and(
						eq(schema.automationRule.id, input.ruleId),
						eq(schema.automationRule.userId, input.userId),
					),
				)
				.returning(),
		);
		return updated ? toRuleView(updated) : null;
	});

	const deleteUserRule = Effect.fn("AutomationsRepository.deleteUserRule")(function* (input: {
		userId: UserId;
		ruleId: AutomationRuleId;
	}) {
		const db = yield* CurrentDb;
		const deleted = yield* dbEffect(() =>
			db
				.delete(schema.automationRule)
				.where(
					and(
						eq(schema.automationRule.id, input.ruleId),
						eq(schema.automationRule.userId, input.userId),
					),
				)
				.returning({ id: schema.automationRule.id }),
		);
		return deleted.length > 0;
	});

	const lockUserAndCountSignalSchemas = Effect.fn(
		"AutomationsRepository.lockUserAndCountSignalSchemas",
	)(function* (userId: UserId) {
		return yield* lockUserAndCountOwnedRows({
			userId,
			table: schema.signalSchema,
			ownerColumn: schema.signalSchema.userId,
		});
	});

	const findUserSignalSchemaBySlug = Effect.fn("AutomationsRepository.findUserSignalSchemaBySlug")(
		function* (input: { userId: UserId; slug: string }) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ id: schema.signalSchema.id })
					.from(schema.signalSchema)
					.where(
						and(
							eq(schema.signalSchema.slug, input.slug),
							eq(schema.signalSchema.userId, input.userId),
						),
					)
					.limit(1),
			);
			return row ? { id: SignalSchemaId.make(row.id) } : null;
		},
	);

	const insertUserSignalSchema = Effect.fn("AutomationsRepository.insertUserSignalSchema")(
		function* (input: {
			slug: string;
			name: string;
			userId: UserId;
			propertiesSchema: AppSchema;
			audiencePolicy: SignalAudiencePolicy;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.insert(schema.signalSchema)
					.values({
						isBuiltin: false,
						slug: input.slug,
						name: input.name,
						userId: input.userId,
						catalogState: "hidden",
						audiencePolicy: input.audiencePolicy,
						propertiesSchema: input.propertiesSchema,
					})
					.returning(),
			);
			if (!row) {
				return yield* new DbError({ message: "Signal schema insert returned no row" });
			}
			return toUserSignalSchemaView(row);
		},
	);

	const listUserSignalSchemas = Effect.fn("AutomationsRepository.listUserSignalSchemas")(function* (
		userId: UserId,
	) {
		const db = yield* CurrentDb;
		const rows = yield* dbEffect(() =>
			db
				.select()
				.from(schema.signalSchema)
				.where(eq(schema.signalSchema.userId, userId))
				.orderBy(asc(schema.signalSchema.name), asc(schema.signalSchema.id)),
		);
		return rows.map(toUserSignalSchemaView);
	});

	const getUserSignalSchema = Effect.fn("AutomationsRepository.getUserSignalSchema")(
		function* (input: { userId: UserId; signalSchemaId: SignalSchemaId }) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select()
					.from(schema.signalSchema)
					.where(
						and(
							eq(schema.signalSchema.id, input.signalSchemaId),
							eq(schema.signalSchema.userId, input.userId),
						),
					)
					.limit(1),
			);
			return row ? toUserSignalSchemaView(row) : null;
		},
	);

	const archiveUserSignalSchema = Effect.fn("AutomationsRepository.archiveUserSignalSchema")(
		function* (input: { userId: UserId; signalSchemaId: SignalSchemaId; archivedAt: Date }) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select()
					.from(schema.signalSchema)
					.where(
						and(
							eq(schema.signalSchema.id, input.signalSchemaId),
							eq(schema.signalSchema.userId, input.userId),
						),
					)
					.for("update")
					.limit(1),
			);
			if (!row) {
				return null;
			}
			yield* dbEffect(() =>
				db
					.update(schema.automationRule)
					.set({ isActive: false })
					.where(
						and(
							eq(schema.automationRule.userId, input.userId),
							eq(schema.automationRule.signalSchemaId, input.signalSchemaId),
						),
					),
			);
			if (row.archivedAt) {
				return toUserSignalSchemaView(row);
			}
			const [updated] = yield* dbEffect(() =>
				db
					.update(schema.signalSchema)
					.set({ archivedAt: input.archivedAt })
					.where(eq(schema.signalSchema.id, input.signalSchemaId))
					.returning(),
			);
			return updated ? toUserSignalSchemaView(updated) : null;
		},
	);

	return {
		insertUserRule,
		getRuleForUser,
		updateUserRule,
		deleteUserRule,
		listRulesForUser,
		getUserOwnedScript,
		getUserSignalSchema,
		listUserSignalSchemas,
		insertUserSignalSchema,
		archiveUserSignalSchema,
		findUserSignalSchemaBySlug,
		getLifecycleSchemaVisibility,
		lockUserAndCountSignalSchemas,
	};
};
