import { DbError } from "@ryot/contract/errors";
import type {
	AutomationOrigin,
	SignalAudiencePolicy,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	EventSchemaId,
	SandboxScriptId,
	SignalSchemaId,
	UserId,
	type EntityId,
	type EntitySchemaId,
	type RelationshipSchemaId,
	type SignalId,
} from "@ryot/contract/schema/brands";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Effect, Match } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, lockUserAndCountOwnedRows } from "#lib/infrastructure/db/service";

export const makeAutomationSourceRepository = () => {
	const listEventCreatePolicies = Effect.fn("AutomationsRepository.listEventCreatePolicies")(
		function* (input: { userId: UserId; eventSchemaIds: ReadonlyArray<EventSchemaId> }) {
			if (input.eventSchemaIds.length === 0) {
				return [];
			}
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select({
						id: schema.automationRule.id,
						position: schema.automationRule.position,
						eventSchemaId: schema.automationRule.eventSchemaId,
						sandboxScriptId: schema.automationRule.sandboxScriptId,
					})
					.from(schema.automationRule)
					.where(
						and(
							inArray(schema.automationRule.eventSchemaId, input.eventSchemaIds),
							eq(schema.automationRule.isActive, true),
							eq(schema.automationRule.kind, "policy"),
							eq(schema.automationRule.operation, "create"),
							or(
								isNull(schema.automationRule.userId),
								eq(schema.automationRule.userId, input.userId),
							),
						),
					)
					.orderBy(
						asc(sql<number>`coalesce(${schema.automationRule.position}, 1000)`),
						asc(schema.automationRule.id),
					),
			);
			return rows.flatMap((row) =>
				row.eventSchemaId === null
					? []
					: [
							{
								position: row.position ?? 1000,
								id: AutomationRuleId.make(row.id),
								eventSchemaId: EventSchemaId.make(row.eventSchemaId),
								sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
							},
						],
			);
		},
	);

	const getSignalById = Effect.fn("AutomationsRepository.getSignalById")(function* (
		signalId: SignalId,
	) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db.select().from(schema.signal).where(eq(schema.signal.id, signalId)).limit(1),
		);
		return row ?? null;
	});

	const getSignalSchemaById = Effect.fn("AutomationsRepository.getSignalSchemaById")(function* (
		signalSchemaId: SignalSchemaId,
	) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.select()
				.from(schema.signalSchema)
				.where(eq(schema.signalSchema.id, signalSchemaId))
				.limit(1),
		);
		return row ?? null;
	});

	const getBuiltinSignalSchemaBySlug = Effect.fn(
		"AutomationsRepository.getBuiltinSignalSchemaBySlug",
	)(function* (slug: string) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.select({ id: schema.signalSchema.id })
				.from(schema.signalSchema)
				.where(
					and(
						eq(schema.signalSchema.slug, slug),
						eq(schema.signalSchema.isBuiltin, true),
						isNull(schema.signalSchema.userId),
						isNull(schema.signalSchema.archivedAt),
					),
				)
				.limit(1),
		);
		return row ? SignalSchemaId.make(row.id) : null;
	});

	const getRelationshipSchemaById = Effect.fn("AutomationsRepository.getRelationshipSchemaById")(
		function* (relationshipSchemaId: RelationshipSchemaId) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						userId: schema.relationshipSchema.userId,
						isBuiltin: schema.relationshipSchema.isBuiltin,
					})
					.from(schema.relationshipSchema)
					.where(eq(schema.relationshipSchema.id, relationshipSchemaId))
					.limit(1),
			);
			return row ?? null;
		},
	);

	const isEntityReadable = Effect.fn("AutomationsRepository.isEntityReadable")(function* (
		userId: UserId,
		entityId: EntityId,
	) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.select({ id: schema.entity.id })
				.from(schema.entity)
				.where(
					and(
						eq(schema.entity.id, entityId),
						or(eq(schema.entity.userId, userId), isNull(schema.entity.userId)),
					),
				)
				.limit(1),
		);
		return row !== undefined;
	});

	const resolveRecipients = Effect.fn("AutomationsRepository.resolveRecipients")(function* (input: {
		actorUserId: UserId | null;
		subjectEntityId: EntityId | null;
		audiencePolicy: SignalAudiencePolicy;
	}) {
		const db = yield* CurrentDb;
		if (input.audiencePolicy.kind === "actor") {
			if (!input.actorUserId) {
				return [];
			}
			const actorUserId = input.actorUserId;
			const rows = yield* dbEffect(() =>
				db
					.select({ id: schema.user.id })
					.from(schema.user)
					.where(and(eq(schema.user.id, actorUserId), isNull(schema.user.disabledAt))),
			);
			return rows.map((row) => UserId.make(row.id));
		}

		if (!input.subjectEntityId) {
			return [];
		}
		const audiencePolicy = input.audiencePolicy;
		const subjectEntityId = input.subjectEntityId;
		const subjectColumn =
			audiencePolicy.subjectSide === "source"
				? schema.relationship.sourceEntityId
				: schema.relationship.targetEntityId;
		const rows = yield* dbEffect(() =>
			db
				.selectDistinct({ id: schema.relationship.userId })
				.from(schema.relationship)
				.innerJoin(schema.user, eq(schema.user.id, schema.relationship.userId))
				.where(
					and(
						eq(subjectColumn, subjectEntityId),
						isNotNull(schema.relationship.userId),
						isNull(schema.user.disabledAt),
						eq(schema.relationship.relationshipSchemaId, audiencePolicy.relationshipSchemaId),
					),
				),
		);
		return rows.flatMap((row) => (row.id ? [UserId.make(row.id)] : []));
	});

	const listLifecycleSubscriptions = Effect.fn("AutomationsRepository.listLifecycleSubscriptions")(
		function* (
			input:
				| {
						kind: "entity";
						userId: UserId | null;
						schemaId: EntitySchemaId;
						operation: "create" | "update" | "delete";
				  }
				| {
						kind: "event";
						userId: UserId | null;
						schemaId: EventSchemaId;
						operation: "create" | "update" | "delete";
				  }
				| {
						kind: "relationship";
						userId: UserId | null;
						schemaId: RelationshipSchemaId;
						operation: "create" | "update" | "delete";
				  },
		) {
			const db = yield* CurrentDb;
			const target = Match.value(input).pipe(
				Match.when({ kind: "entity" }, ({ schemaId }) =>
					eq(schema.automationRule.entitySchemaId, schemaId),
				),
				Match.when({ kind: "event" }, ({ schemaId }) =>
					eq(schema.automationRule.eventSchemaId, schemaId),
				),
				Match.when({ kind: "relationship" }, ({ schemaId }) =>
					eq(schema.automationRule.relationshipSchemaId, schemaId),
				),
				Match.exhaustive,
			);
			const ownership = input.userId
				? or(isNull(schema.automationRule.userId), eq(schema.automationRule.userId, input.userId))
				: isNull(schema.automationRule.userId);
			const rows = yield* dbEffect(() =>
				db
					.select({ id: schema.automationRule.id })
					.from(schema.automationRule)
					.where(
						and(
							target,
							ownership,
							eq(schema.automationRule.isActive, true),
							eq(schema.automationRule.kind, "subscription"),
							eq(schema.automationRule.operation, input.operation),
						),
					),
			);
			return rows.map((row) => ({ id: AutomationRuleId.make(row.id) }));
		},
	);

	const insertSignal = Effect.fn("AutomationsRepository.insertSignal")(function* (input: {
		id: SignalId;
		occurredAt: Date;
		correlationId: string;
		automationDepth: number;
		origin: AutomationOrigin;
		actorUserId: UserId | null;
		causationId: string | null;
		signalSchemaId: SignalSchemaId;
		subjectEntityId: EntityId | null;
		properties: Record<string, unknown>;
		recipientIds: ReadonlyArray<UserId>;
	}) {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.insert(schema.signal)
				.values({
					id: input.id,
					origin: input.origin,
					properties: input.properties,
					occurredAt: input.occurredAt,
					causationId: input.causationId,
					actorUserId: input.actorUserId,
					correlationId: input.correlationId,
					signalSchemaId: input.signalSchemaId,
					automationDepth: input.automationDepth,
					subjectEntityId: input.subjectEntityId,
				})
				.returning(),
		);
		if (!row) {
			return yield* new DbError({ message: "Signal insert returned no row" });
		}
		if (input.recipientIds.length > 0) {
			yield* dbEffect(() =>
				db.insert(schema.signalRecipient).values(
					input.recipientIds.map((userId) => ({
						userId,
						signalId: row.id,
						signalCreatedAt: row.createdAt,
						signalSchemaId: row.signalSchemaId,
					})),
				),
			);
		}
		return row;
	});

	const lockUserAndCountRules = Effect.fn("AutomationsRepository.lockUserAndCountRules")(function* (
		userId: UserId,
	) {
		return yield* lockUserAndCountOwnedRows({
			userId,
			table: schema.automationRule,
			ownerColumn: schema.automationRule.userId,
		});
	});

	return {
		insertSignal,
		getSignalById,
		isEntityReadable,
		resolveRecipients,
		getSignalSchemaById,
		lockUserAndCountRules,
		listEventCreatePolicies,
		getRelationshipSchemaById,
		listLifecycleSubscriptions,
		getBuiltinSignalSchemaBySlug,
	};
};
