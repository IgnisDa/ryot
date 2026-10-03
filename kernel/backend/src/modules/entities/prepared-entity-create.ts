import type { EntityId, EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";

const preparedEntityCreate = Symbol("PreparedEntityCreate");

type PreparedEntityCreateData = {
	readonly userId: UserId;
	readonly entityId: EntityId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entitySchemaPluginId: string | null;
};

export type PreparedEntityCreate = { readonly [preparedEntityCreate]: PreparedEntityCreateData };

export const makePreparedEntityCreate = (data: PreparedEntityCreateData): PreparedEntityCreate =>
	Object.freeze({ [preparedEntityCreate]: data });

export const preparedEntityCreateData = (token: PreparedEntityCreate) =>
	token[preparedEntityCreate];
