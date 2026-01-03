import { Context, Effect, Layer } from "effect";

import type { DbError } from "#lib/errors";

export class EntityImportHook extends Context.Tag("EntityImportHook")<
	EntityImportHook,
	{
		readonly onEntityImported: (userId: string, entityId: string) => Effect.Effect<void, DbError>;
	}
>() {
	static readonly Default = Layer.succeed(EntityImportHook, {
		onEntityImported: (): Effect.Effect<void, DbError> => Effect.void,
	});
}
