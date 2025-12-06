import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import type {
	MediaMonitoringAssociationSnapshot,
	MediaMonitoringEntityKind,
	MediaMonitoringSeasonSnapshot,
} from "./diff";
import { snapshotEpisode, snapshotProperties, snapshotSeason } from "./diff";
import {
	isMediaMonitoringAssociationTargetSchema,
	mediaMonitorableEntitySchemaSlugs,
} from "./monitorable";

const sourceEntitySchema = alias(schema.entitySchema, "media_monitoring_source_entity_schema");
const targetEntitySchema = alias(schema.entitySchema, "media_monitoring_target_entity_schema");

export type MediaMonitoringTarget = {
	entityId: EntityId;
	entitySchemaId: EntitySchemaId;
	entitySchemaSlug: string;
	externalId: string;
	sandboxScriptId: SandboxScriptId;
};

type Edge = {
	entityId: EntityId;
	externalId: string | null;
	entitySchemaSlug: string;
	name: string;
	properties: Record<string, unknown>;
	relationshipProperties: Record<string, unknown>;
	sandboxScriptId: string | null;
	sourceSchemaSlug: string;
	targetSchemaSlug: string;
};

const asRecord = (value: unknown): Record<string, unknown> => (isObjectRecord(value) ? value : {});

const toKind = (slug: string): MediaMonitoringEntityKind =>
	slug === "person" || slug === "company" ? slug : "media";

export class MediaMonitoringRepository extends Effect.Service<MediaMonitoringRepository>()(
	"MediaMonitoringRepository",
	{
		sync: () => {
			const getProviderProvenance = Effect.fn("MediaMonitoringRepository.getProviderProvenance")(
				function* (entityId: EntityId) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({
								externalId: schema.entity.externalId,
								sandboxScriptId: schema.entity.sandboxScriptId,
							})
							.from(schema.entity)
							.where(and(eq(schema.entity.id, entityId), isNull(schema.entity.userId)))
							.limit(1),
					);
					return row?.externalId && row.sandboxScriptId
						? { externalId: row.externalId, sandboxScriptId: row.sandboxScriptId }
						: null;
				},
			);

			const getEntity = Effect.fn("MediaMonitoringRepository.getEntity")(function* (
				entityId: EntityId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							entityId: schema.entity.id,
							externalId: schema.entity.externalId,
							entitySchemaSlug: schema.entitySchema.slug,
							name: schema.entity.name,
							properties: schema.entity.properties,
							populatedAt: schema.entity.populatedAt,
							userId: schema.entity.userId,
						})
						.from(schema.entity)
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(eq(schema.entity.id, entityId))
						.limit(1),
				);
				return row ?? null;
			});

			const listOutgoingEdges = Effect.fn("MediaMonitoringRepository.listOutgoingEdges")(function* (
				entityId: EntityId,
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({
							entityId: schema.entity.id,
							externalId: schema.entity.externalId,
							entitySchemaSlug: schema.entitySchema.slug,
							name: schema.entity.name,
							properties: schema.entity.properties,
							relationshipProperties: schema.relationship.properties,
							sandboxScriptId: schema.entity.sandboxScriptId,
							sourceSchemaSlug: sourceEntitySchema.slug,
							targetSchemaSlug: targetEntitySchema.slug,
						})
						.from(schema.relationship)
						.innerJoin(schema.entity, eq(schema.relationship.targetEntityId, schema.entity.id))
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.innerJoin(
							schema.relationshipSchema,
							eq(schema.relationship.relationshipSchemaId, schema.relationshipSchema.id),
						)
						.leftJoin(
							sourceEntitySchema,
							eq(schema.relationshipSchema.sourceEntitySchemaId, sourceEntitySchema.id),
						)
						.leftJoin(
							targetEntitySchema,
							eq(schema.relationshipSchema.targetEntitySchemaId, targetEntitySchema.id),
						)
						.where(
							and(
								isNull(schema.relationship.userId),
								eq(schema.relationship.sourceEntityId, entityId),
							),
						)
						.orderBy(asc(schema.entity.name), asc(schema.entity.id)),
				);

				return rows.map(
					(row) =>
						({
							entityId: EntityId.make(row.entityId),
							externalId: row.externalId,
							entitySchemaSlug: row.entitySchemaSlug,
							name: row.name,
							properties: asRecord(row.properties),
							relationshipProperties: asRecord(row.relationshipProperties),
							sandboxScriptId: row.sandboxScriptId,
							sourceSchemaSlug: row.sourceSchemaSlug ?? "",
							targetSchemaSlug: row.targetSchemaSlug ?? row.entitySchemaSlug,
						}) satisfies Edge,
				);
			});

			const listIncomingEdges = Effect.fn("MediaMonitoringRepository.listIncomingEdges")(function* (
				entityId: EntityId,
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({
							entityId: schema.entity.id,
							externalId: schema.entity.externalId,
							entitySchemaSlug: schema.entitySchema.slug,
							name: schema.entity.name,
							properties: schema.entity.properties,
							relationshipProperties: schema.relationship.properties,
							sandboxScriptId: schema.entity.sandboxScriptId,
							sourceSchemaSlug: sourceEntitySchema.slug,
							targetSchemaSlug: targetEntitySchema.slug,
						})
						.from(schema.relationship)
						.innerJoin(schema.entity, eq(schema.relationship.sourceEntityId, schema.entity.id))
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.innerJoin(
							schema.relationshipSchema,
							eq(schema.relationship.relationshipSchemaId, schema.relationshipSchema.id),
						)
						.leftJoin(
							sourceEntitySchema,
							eq(schema.relationshipSchema.sourceEntitySchemaId, sourceEntitySchema.id),
						)
						.leftJoin(
							targetEntitySchema,
							eq(schema.relationshipSchema.targetEntitySchemaId, targetEntitySchema.id),
						)
						.where(
							and(
								isNull(schema.relationship.userId),
								eq(schema.relationship.targetEntityId, entityId),
							),
						)
						.orderBy(asc(schema.entity.name), asc(schema.entity.id)),
				);

				return rows.map(
					(row) =>
						({
							entityId: EntityId.make(row.entityId),
							externalId: row.externalId,
							entitySchemaSlug: row.entitySchemaSlug,
							name: row.name,
							properties: asRecord(row.properties),
							relationshipProperties: asRecord(row.relationshipProperties),
							sandboxScriptId: row.sandboxScriptId,
							sourceSchemaSlug: row.sourceSchemaSlug ?? row.entitySchemaSlug,
							targetSchemaSlug: row.targetSchemaSlug ?? "",
						}) satisfies Edge,
				);
			});

			const listTargets = Effect.fn("MediaMonitoringRepository.listTargets")(function* () {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.selectDistinct({
							entityId: schema.entity.id,
							entitySchemaId: schema.entity.entitySchemaId,
							entitySchemaSlug: schema.entitySchema.slug,
							externalId: schema.entity.externalId,
							sandboxScriptId: schema.entity.sandboxScriptId,
						})
						.from(schema.relationship)
						.innerJoin(schema.entity, eq(schema.relationship.sourceEntityId, schema.entity.id))
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.innerJoin(
							schema.relationshipSchema,
							eq(schema.relationship.relationshipSchemaId, schema.relationshipSchema.id),
						)
						.where(
							and(
								eq(schema.relationshipSchema.slug, "media-monitoring"),
								isNotNull(schema.relationship.userId),
								isNull(schema.entity.userId),
								isNotNull(schema.entity.externalId),
								isNotNull(schema.entity.sandboxScriptId),
								inArray(schema.entitySchema.slug, mediaMonitorableEntitySchemaSlugs),
							),
						)
						.orderBy(asc(schema.entity.id)),
				);

				return rows.flatMap((row) =>
					row.externalId && row.sandboxScriptId
						? [
								{
									entityId: EntityId.make(row.entityId),
									entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
									entitySchemaSlug: row.entitySchemaSlug,
									externalId: row.externalId,
									sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
								} satisfies MediaMonitoringTarget,
							]
						: [],
				);
			});

			const listSubscribers = Effect.fn("MediaMonitoringRepository.listSubscribers")(function* (
				entityId: EntityId,
			) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ userId: schema.relationship.userId })
						.from(schema.relationship)
						.innerJoin(
							schema.relationshipSchema,
							eq(schema.relationship.relationshipSchemaId, schema.relationshipSchema.id),
						)
						.innerJoin(schema.entity, eq(schema.relationship.targetEntityId, schema.entity.id))
						.innerJoin(
							schema.entitySchema,
							eq(schema.entity.entitySchemaId, schema.entitySchema.id),
						)
						.where(
							and(
								eq(schema.relationship.sourceEntityId, entityId),
								eq(schema.relationshipSchema.slug, "media-monitoring"),
								isNotNull(schema.relationship.userId),
								eq(schema.entitySchema.slug, "library"),
							),
						),
				);
				return rows.flatMap((row) => (row.userId ? [UserId.make(row.userId)] : []));
			});

			const getLibraryEntityId = Effect.fn("MediaMonitoringRepository.getLibraryEntityId")(
				function* (userId: UserId) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.innerJoin(
								schema.entitySchema,
								eq(schema.entity.entitySchemaId, schema.entitySchema.id),
							)
							.where(
								and(
									eq(schema.entity.userId, userId),
									eq(schema.entitySchema.slug, "library"),
									isNull(schema.entitySchema.userId),
								),
							)
							.limit(1),
					);
					return row ? EntityId.make(row.id) : null;
				},
			);

			const getSnapshot = Effect.fn("MediaMonitoringRepository.getSnapshot")(function* (
				entityId: EntityId,
			) {
				const entity = yield* getEntity(entityId);
				if (entity?.userId !== null) {
					return null;
				}

				const direct = yield* listOutgoingEdges(entityId);
				const nested = yield* Effect.forEach(
					direct.filter((edge) => edge.entitySchemaSlug === "show-season"),
					(edge) => listOutgoingEdges(edge.entityId),
				);
				const seasons: MediaMonitoringSeasonSnapshot[] = [];
				for (const [index, season] of direct
					.filter((edge) => edge.entitySchemaSlug === "show-season")
					.entries()) {
					const seasonSnapshot = snapshotSeason({
						externalId: season.externalId,
						name: season.name,
						properties: season.properties,
					});
					const episodes = (nested[index] ?? [])
						.filter(
							(edge) =>
								edge.entitySchemaSlug === "show-episode" && edge.sourceSchemaSlug === "show-season",
						)
						.map((episode) =>
							snapshotEpisode({
								externalId: episode.externalId,
								name: episode.name,
								properties: episode.properties,
							}),
						);
					seasons.push({ ...seasonSnapshot, episodes });
				}

				const podcastEpisodes = direct
					.filter((edge) => edge.entitySchemaSlug === "podcast-episode")
					.map((edge) =>
						snapshotEpisode({
							externalId: edge.externalId,
							name: edge.name,
							properties: edge.properties,
						}),
					);
				const incoming = yield* listIncomingEdges(entityId);
				const kind = toKind(entity.entitySchemaSlug);
				const associations: MediaMonitoringAssociationSnapshot[] = [];
				if (kind !== "media") {
					for (const edge of [...direct, ...incoming]) {
						const associationIsOutgoing = edge.sourceSchemaSlug === kind;
						const associationIsIncoming = edge.targetSchemaSlug === kind;
						if (!associationIsOutgoing && !associationIsIncoming) {
							continue;
						}
						if (!isMediaMonitoringAssociationTargetSchema(edge.entitySchemaSlug)) {
							continue;
						}
						const roles = Array.isArray(edge.relationshipProperties.roles)
							? edge.relationshipProperties.roles.filter(
									(item): item is string => typeof item === "string",
								)
							: [""];
						for (const role of roles.length === 0 ? [""] : roles) {
							associations.push({
								id:
									edge.externalId && edge.sandboxScriptId
										? `${edge.sandboxScriptId}:${edge.externalId}`
										: edge.entityId,
								name: edge.name,
								role,
								kind: edge.entitySchemaSlug.endsWith("-group") ? "group" : "metadata",
							});
						}
					}
				}

				return {
					entityId,
					entityKind: kind,
					entitySchemaSlug: entity.entitySchemaSlug,
					name: entity.name,
					populatedAt: entity.populatedAt?.toISOString() ?? null,
					properties: snapshotProperties(entity.properties),
					seasons,
					animeEpisodes:
						typeof entity.properties.episodes === "number" ? entity.properties.episodes : null,
					mangaChapters:
						typeof entity.properties.chapters === "number" ? entity.properties.chapters : null,
					podcastEpisodes,
					associations,
				};
			});

			return {
				getLibraryEntityId,
				getProviderProvenance,
				getSnapshot,
				listSubscribers,
				listTargets,
			};
		},
	},
) {}
