import type { DbError } from "@ryot-app/contract/errors";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, type Effect } from "effect";

export type EntityUserDataAttachment = {
	readonly id: string;
	readonly revision: number;
	readonly entityId: null | EntityId;
	readonly parentEntityId: null | EntityId;
};

export class EntityUserDataAttachments extends Context.Service<
	EntityUserDataAttachments,
	{
		readonly removeEntities: (entityIds: ReadonlyArray<EntityId>) => Effect.Effect<void, DbError>;
		readonly clear: (input: {
			readonly userId: UserId;
			readonly ids: ReadonlyArray<string>;
		}) => Effect.Effect<void, DbError>;
		readonly list: (input: {
			readonly userId: UserId;
			readonly entityIds: ReadonlyArray<EntityId>;
		}) => Effect.Effect<ReadonlyArray<EntityUserDataAttachment>, DbError>;
		readonly move: (input: {
			readonly userId: UserId;
			readonly ids: ReadonlyArray<string>;
			readonly references: ReadonlyMap<EntityId, EntityId>;
		}) => Effect.Effect<void, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/entities/user-data/attachments/EntityUserDataAttachments") {}
