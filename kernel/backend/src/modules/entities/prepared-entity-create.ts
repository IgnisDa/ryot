import type { EntityId, EntitySchemaSlug, UserId } from "@ryot-app/contract/schema/brands";

const preparedEntityCreate = Symbol("PreparedEntityCreate");

export type PreparedEntityCreate = { readonly [preparedEntityCreate]: PreparedEntityCreateData };

type PreparedEntityCreateData = {
	readonly userId: UserId;
	readonly entityId: EntityId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entitySchemaPluginId: null | string;
};

export const makePreparedEntityCreate = (data: PreparedEntityCreateData): PreparedEntityCreate =>
	Object.freeze({ [preparedEntityCreate]: data });

export const preparedEntityCreateData = (token: PreparedEntityCreate) =>
	token[preparedEntityCreate];
