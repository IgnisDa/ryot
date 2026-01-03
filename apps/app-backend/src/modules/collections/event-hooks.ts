import { Effect, Layer } from "effect";

import { EntityImportHook } from "#modules/entities/entity-import-hook";
import { GlobalEntityReferenceHook } from "#modules/events/global-entity-reference-hook";

import { CollectionsService } from "./service";

export const EntityImportHookLive = Layer.effect(
	EntityImportHook,
	Effect.map(CollectionsService, (cs) => ({
		onEntityImported: (userId: string, entityId: string) =>
			cs.ensureEntityInLibrary(userId, entityId),
	})),
);

export const GlobalEntityReferenceHookLive = Layer.effect(
	GlobalEntityReferenceHook,
	Effect.map(CollectionsService, (cs) => ({
		onGlobalEntityReferenced: (userId: string, entityId: string) =>
			cs.ensureEntityInLibrary(userId, entityId),
	})),
);
