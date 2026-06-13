import { eq, isNull, or } from "drizzle-orm";

import * as schema from "#lib/db/schema/tables/combined";
import type { UserId } from "#lib/schema/brands";
import { EntityId, EntitySchemaId, SandboxScriptId } from "#lib/schema/brands";
import type { AppSchema } from "#lib/schema/property-schema";

type EntityRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "entitySchemaId"
	| "sandboxScriptId"
>;

export type EntitySchemaScope = {
	readonly id: EntitySchemaId;
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly userId: UserId | null;
	readonly propertiesSchema: AppSchema;
};

export type EntityScope = {
	readonly entityId: EntityId;
	readonly isBuiltin: boolean;
	readonly entitySchemaId: EntitySchemaId;
	readonly entitySchemaSlug: string;
	readonly entityUserId: UserId | null;
};

export type EntityMergeScope = EntityScope & {
	readonly properties: Record<string, unknown>;
};

export type EntitySchemaScriptScope = {
	readonly entitySchemaId: EntitySchemaId;
	readonly sandboxScriptId: SandboxScriptId;
};

export const entitySelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	properties: schema.entity.properties,
	externalId: schema.entity.externalId,
	populatedAt: schema.entity.populatedAt,
	entitySchemaId: schema.entity.entitySchemaId,
	sandboxScriptId: schema.entity.sandboxScriptId,
};

export const entitySchemaVisibleToUserClause = (userId: UserId) =>
	or(isNull(schema.entitySchema.userId), eq(schema.entitySchema.userId, userId));

export const entityVisibleToUserClause = (userId: UserId) =>
	or(isNull(schema.entity.userId), eq(schema.entity.userId, userId));

export const toListedEntity = (row: EntityRow) => ({
	name: row.name,
	properties: row.properties,
	externalId: row.externalId,
	id: EntityId.make(row.id),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	populatedAt: row.populatedAt?.toISOString() ?? null,
	entitySchemaId: EntitySchemaId.make(row.entitySchemaId),
	sandboxScriptId: row.sandboxScriptId ? SandboxScriptId.make(row.sandboxScriptId) : null,
});
