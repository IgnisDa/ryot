import { Context, Effect, Layer } from "effect";

import type { DbError } from "#lib/errors";

export class GlobalEntityHook extends Context.Tag("GlobalEntityHook")<
	GlobalEntityHook,
	{ readonly onGlobalEntity: (userId: string, entityId: string) => Effect.Effect<void, DbError> }
>() {
	static readonly Default = Layer.succeed(GlobalEntityHook, {
		onGlobalEntity: (): Effect.Effect<void, DbError> => Effect.void,
	});
}
