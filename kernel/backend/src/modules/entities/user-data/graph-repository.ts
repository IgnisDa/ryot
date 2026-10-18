import type { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId, EventId, type UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { chunksOf } from "effect/Array";

import { STATEMENT_CHUNK_SIZE } from "#modules/entities/repository";
import { entityVisibleToUserClause } from "#modules/entities/repository-support";
import { pluginIdWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

export class EntityUserDataGraphRepository extends Context.Service<EntityUserDataGraphRepository>()(
	"EntityUserDataGraphRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const listChildren = Effect.fn("EntityUserDataGraphRepository.listChildren")(
				function* (input: {
					userId: UserId;
					entityId: EntityId;
					pluginId: null | string;
					child: NonNullable<PluginEntityUserStatePolicy["children"]>[number];
				}) {
					let ids: readonly string[] = [input.entityId];
					let children: {
						id: EntityId;
						name: string;
						updatedAt: string;
						properties: Record<string, unknown>;
					}[] = [];
					for (const [index, slug] of input.child.path.entries()) {
						children = (yield* Effect.forEach(chunksOf(ids, STATEMENT_CHUNK_SIZE), (batch) =>
							session.run((db) =>
								db
									.select({
										id: tables.entity.id,
										name: tables.entity.name,
										updatedAt: tables.entity.updatedAt,
										properties: tables.entity.properties,
									})
									.from(tables.relationship)
									.innerJoin(
										tables.entity,
										eq(tables.entity.id, tables.relationship.targetEntityId),
									)
									.where(
										and(
											inArray(tables.relationship.sourceEntityId, batch),
											eq(tables.relationship.relationshipSchemaSlug, slug),
											pluginIdWhere(tables.relationship.relationshipSchemaPluginId, input.pluginId),
											pluginIdWhere(tables.entity.entitySchemaPluginId, input.pluginId),
											or(
												isNull(tables.relationship.userId),
												eq(tables.relationship.userId, input.userId),
											),
											entityVisibleToUserClause(input.userId),
											index === input.child.path.length - 1
												? eq(tables.entity.entitySchemaSlug, input.child.entitySchemaSlug)
												: undefined,
										),
									)
									.orderBy(asc(tables.entity.id)),
							),
						))
							.flat()
							.map((row) => ({
								name: row.name,
								id: EntityId.make(row.id),
								properties: row.properties,
								updatedAt: row.updatedAt.toISOString(),
							}));
						ids = [...new Set(children.map((child) => child.id))];
					}
					return [...new Map(children.map((child) => [child.id, child])).values()];
				},
			);
			const listEvidence = Effect.fn("EntityUserDataGraphRepository.listEvidence")(
				function* (input: {
					userId: UserId;
					pluginId: null | string;
					entityIds: readonly EntityId[];
					evidence: NonNullable<PluginEntityUserStatePolicy["evidence"]>[number];
				}) {
					const reference = input.evidence.eventSchema;
					const pluginId = reference.owner.kind === "kernel" ? null : input.pluginId;
					return (yield* Effect.forEach(chunksOf(input.entityIds, STATEMENT_CHUNK_SIZE), (ids) =>
						session.run((db) =>
							db
								.select({
									id: tables.event.id,
									entityId: tables.event.entityId,
									properties: tables.event.properties,
								})
								.from(tables.event)
								.innerJoin(tables.entity, eq(tables.entity.id, tables.event.entityId))
								.where(
									and(
										eq(tables.event.userId, input.userId),
										pluginIdWhere(tables.event.eventSchemaPluginId, pluginId),
										pluginIdWhere(tables.entity.entitySchemaPluginId, pluginId),
										eq(tables.entity.entitySchemaSlug, reference.entitySchemaSlug),
										entityVisibleToUserClause(input.userId),
										eq(tables.event.eventSchemaSlug, reference.slug),
										inArray(
											sql<string>`${tables.event.properties}->>${input.evidence.subjectProperty}`,
											ids,
										),
									),
								)
								.orderBy(asc(tables.event.id)),
						),
					))
						.flat()
						.map((row) =>
							Object.assign(row, {
								id: EventId.make(row.id),
								entityId: EntityId.make(row.entityId),
							}),
						);
				},
			);
			return { listChildren, listEvidence };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
