import { buildSavedViewRecordDocument } from "@ryot/ryotql-recipes/saved-view-records";
import { Effect, type Layer } from "effect";

import { AppQueryClient } from "@/api/query-client-service";
import { canonicalApiScope, keyedRequestFamily, scopedReactivityKey } from "@/api/request-key";

import { savedViewRecordRequestKey, type SavedViewRecordRequest } from "./atom-requests";

export const makeSavedViewRecordAtom = (layer: Layer.Layer<AppQueryClient>) => {
	const queryClient = Effect.runSync(AppQueryClient.pipe(Effect.provide(layer)));
	return keyedRequestFamily(savedViewRecordRequestKey, (request: SavedViewRecordRequest) => {
		const scope = canonicalApiScope(request);
		return queryClient.get(scope.serverUrl).query("ryotql", "execute", {
			payload: buildSavedViewRecordDocument({ slug: request.slug }),
			reactivityKeys: scopedReactivityKey("saved-view-record", scope),
		});
	});
};
