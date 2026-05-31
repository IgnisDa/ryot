import { Effect, Layer } from "effect";

import { GlobalEntityReferenceHook } from "#modules/events/global-entity-reference-hook";

import { CollectionsService } from "./service";

export const GlobalEntityReferenceHookLive = Layer.effect(
	GlobalEntityReferenceHook,
	Effect.map(CollectionsService, (cs) => ({
		onGlobalEntityReferenced: (userId: string, entityId: string) =>
			cs.ensureEntityInLibrary(userId, entityId),
	})),
);
