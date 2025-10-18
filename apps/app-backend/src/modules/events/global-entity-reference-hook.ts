import { Context, Effect, Layer } from "effect";

import type { DbError } from "#lib/errors";
import type { EntityId, UserId } from "#lib/schema/brands";

export class GlobalEntityReferenceHook extends Context.Tag("GlobalEntityReferenceHook")<
	GlobalEntityReferenceHook,
	{
		readonly onGlobalEntityReferenced: (
			userId: UserId,
			entityId: EntityId,
		) => Effect.Effect<void, DbError>;
	}
>() {
	static readonly Default = Layer.succeed(GlobalEntityReferenceHook, {
		onGlobalEntityReferenced: (): Effect.Effect<void, DbError> => Effect.void,
	});
}
