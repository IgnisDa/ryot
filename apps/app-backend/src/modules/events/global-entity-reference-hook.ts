import { Context, Effect, Layer } from "effect";

import type { DbError } from "#lib/errors";

export class GlobalEntityReferenceHook extends Context.Tag("GlobalEntityReferenceHook")<
	GlobalEntityReferenceHook,
	{
		readonly onGlobalEntityReferenced: (
			userId: string,
			entityId: string,
		) => Effect.Effect<void, DbError>;
	}
>() {
	static readonly Default = Layer.succeed(GlobalEntityReferenceHook, {
		onGlobalEntityReferenced: (): Effect.Effect<void, DbError> => Effect.void,
	});
}
