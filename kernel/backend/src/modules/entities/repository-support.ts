import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
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
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly id: EntitySchemaSlug;
	readonly userId: UserId | null;
	readonly propertiesSchema: AppSchema;
	readonly pluginId?: string | null | undefined;
};

export type EntityScope = {
	readonly entityId: EntityId;
	readonly isBuiltin: boolean;
	readonly entityUserId: UserId | null;
	readonly entitySchemaSlug: EntitySchemaSlug;
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
	id: EntityId.make(row.id),
	properties: row.properties,
	externalId: row.externalId,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	populatedAt: row.populatedAt?.toISOString() ?? null,
	entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
	providerId: row.providerId ? SandboxProviderId.make(row.providerId) : null,
});
