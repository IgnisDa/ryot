import type { UserId } from "@ryot-app/contract/schema/brands";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { eq, isNull, or } from "drizzle-orm";

import * as schema from "#schema/tables/combined";

export type EntityScope = {
	readonly entityId: EntityId;
	readonly isBuiltin: boolean;
	readonly entityUserId: null | UserId;
	readonly entitySchemaSlug: EntitySchemaSlug;
};

export type EntitySchemaScope = {
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly id: EntitySchemaSlug;
	readonly userId: null | UserId;
	readonly propertiesSchema: AppSchema;
	readonly pluginId?: null | string | undefined;
};

type EntityRow = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "providerId"
	| "populatedAt"
	| "entitySchemaSlug"
	| "entitySchemaPluginId"
>;

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
	entitySchemaPluginId: schema.entity.entitySchemaPluginId,
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
	entitySchemaPluginId:
		row.entitySchemaPluginId === null ? null : PluginId.make(row.entitySchemaPluginId),
});
