import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";

import { type ApiScope, canonicalApiScope, scopedRequestKey } from "@/api/request-key";

import { canonicalManagedAssets } from "./managed-assets";

export type SavedViewRecordRequest = ApiScope & { slug: string };

export type SavedViewResultRequest = ApiScope & { queryDocument: RyotQLDocument };

export type ManagedAssetResolutionRequest = ApiScope & { assets: readonly ManagedAssetLocator[] };

export const savedViewRecordRequestKey = (request: SavedViewRecordRequest) =>
	scopedRequestKey(request, request.slug);

export const savedViewResultRequestKey = (request: SavedViewResultRequest) =>
	scopedRequestKey(request, request.queryDocument);

export const canonicalManagedAssetRequest = (request: ManagedAssetResolutionRequest) => {
	const assets = canonicalManagedAssets(request.assets);
	return {
		assets,
		scope: canonicalApiScope(request),
		key: scopedRequestKey(request, assets),
	};
};
