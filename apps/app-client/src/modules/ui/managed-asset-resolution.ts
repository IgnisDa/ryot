import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

import {
	canonicalManagedAssets,
	mapManagedAssetResolution,
	type ManagedAssetResolutionRequest,
} from "./managed-assets";

const managedAssetResolutionFamily = Atom.family((request: ManagedAssetResolutionRequest) => {
	const client = appClient(request.scope);
	return client
		.query("uploads", "resolveDownloads", {
			payload: { assets: request.assets },
			reactivityKeys: scopedReactivityKey("managed-assets", request.scope),
		})
		.pipe(
			Atom.withRefresh("14 minutes"),
			Atom.map((result) => mapManagedAssetResolution(result, client.resolveApiUrl)),
		);
});

export const managedAssetResolutionAtom = (request: ManagedAssetResolutionRequest) =>
	managedAssetResolutionFamily({
		scope: canonicalApiScope(request.scope),
		assets: canonicalManagedAssets(request.assets),
	});
