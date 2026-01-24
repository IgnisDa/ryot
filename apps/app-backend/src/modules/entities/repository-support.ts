import type { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { eq, isNull, or } from "drizzle-orm";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";

type EntityRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "providerId"
	| "entitySchemaSlug"
>;

export type EntitySchemaScope = {
	readonly id: EntitySchemaSlug;
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly userId: UserId | null;
	readonly propertiesSchema: AppSchema;
};

export type EntityScope = {
	readonly entityId: EntityId;
	readonly isBuiltin: boolean;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entityUserId: UserId | null;
};

export type EntityMergeScope = EntityScope & {
	readonly properties: Record<string, unknown>;
};

export type EntitySchemaProviderDetailsScope = {
	readonly providerId: SandboxProviderId;
	readonly detailsScriptId: SandboxScriptId;
	readonly entitySchemaSlug: EntitySchemaSlug;
};

export const entitySelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	providerId: schema.entity.providerId,
	properties: schema.entity.properties,
	externalId: schema.entity.externalId,
	populatedAt: schema.entity.populatedAt,
	entitySchemaSlug: schema.entity.entitySchemaSlug,
};

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
	entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
	providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
});
