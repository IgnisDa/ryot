import { Effect, Layer } from "effect";

import { EntityUserDataAttachments } from "./attachments";

export const emptyEntityUserDataAttachments = Layer.succeed(EntityUserDataAttachments, {
	move: () => Effect.void,
	clear: () => Effect.void,
	list: () => Effect.succeed([]),
	removeEntities: () => Effect.void,
});
