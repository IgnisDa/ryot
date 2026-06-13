import { Context, Effect, Layer } from "effect";

import type { DbError } from "#lib/errors";
import type { EntityId, UserId } from "#lib/schema/brands";

export class EntityImportHook extends Context.Tag("EntityImportHook")<
	EntityImportHook,
	{
		readonly onEntityImported: (userId: UserId, entityId: EntityId) => Effect.Effect<void, DbError>;
	}
>() {
	static readonly Default = Layer.succeed(EntityImportHook, {
		onEntityImported: (): Effect.Effect<void, DbError> => Effect.void,
	});
}
