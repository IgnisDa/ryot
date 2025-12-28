import { Effect, Layer } from "effect";

import { GlobalEntityHook } from "#modules/events/global-entity-hook";

import { CollectionsService } from "./service";

export const GlobalEntityHookLive = Layer.effect(
	GlobalEntityHook,
	Effect.map(CollectionsService, (cs) => ({
		onGlobalEntity: (userId: string, entityId: string) =>
			cs.ensureEntityInLibrary(userId, entityId),
	})),
);
