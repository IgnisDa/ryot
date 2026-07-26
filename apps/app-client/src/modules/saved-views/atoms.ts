import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { buildSavedViewRecordDocument } from "@ryot/ryotql-recipes/saved-view-records";
import { Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";
import { appStorageRuntime } from "@/persistence/storage";

import { canonicalManagedAssets } from "./managed-assets";
import {
	mapManagedAssetResolution,
	mapSavedViewRecord,
	type SavedViewManagedAssetsState,
} from "./state";
import { type SavedViewLayoutStorageScope, savedViewLayoutStorageKey } from "./storage";

type SavedViewRecordRequest = { readonly scope: ApiScope; readonly slug: string };
type ManagedAssetResolutionRequest = {
	readonly scope: ApiScope;
	readonly assets: readonly ManagedAssetLocator[];
};

const savedViewRecordFamily = Atom.family((request: SavedViewRecordRequest) =>
	appClient(request.scope)
		.query("ryotql", "execute", {
			payload: buildSavedViewRecordDocument({ slug: request.slug }),

			reactivityKeys: scopedReactivityKey("saved-view-record", request.scope),
		})
		.pipe(Atom.map(mapSavedViewRecord)),
);

export const savedViewRecordAtom = (request: SavedViewRecordRequest) =>
	savedViewRecordFamily({ scope: canonicalApiScope(request.scope), slug: request.slug });

const managedAssetResolutionFamily = Atom.family(
	(
		request: ManagedAssetResolutionRequest & { readonly assets: readonly ManagedAssetLocator[] },
	) => {
		const client = appClient(request.scope);
		return client
			.query("uploads", "resolveDownloads", {
				payload: { assets: request.assets },

				reactivityKeys: scopedReactivityKey("managed-assets", request.scope),
			})
			.pipe(
				Atom.withRefresh("14 minutes"),
				Atom.map(
					(result): SavedViewManagedAssetsState =>
						mapManagedAssetResolution(result, client.resolveApiUrl),
				),
			);
	},
);

export const managedAssetResolutionAtom = (request: ManagedAssetResolutionRequest) =>
	managedAssetResolutionFamily({
		scope: canonicalApiScope(request.scope),
		assets: canonicalManagedAssets(request.assets),
	});

const savedViewLayoutFamily = Atom.family((key: string) =>
	Atom.kvs({
		key,
		runtime: appStorageRuntime,
		defaultValue: () => "grid" as const,
		schema: Schema.Literals(["grid", "list", "table"]),
	}),
);

export const savedViewLayoutAtom = (scope: SavedViewLayoutStorageScope) =>
	savedViewLayoutFamily(savedViewLayoutStorageKey(scope));
