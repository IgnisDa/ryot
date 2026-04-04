import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { stableStringify } from "@ryot/ts-utils/json";

export type SavedViewRecordRequest = { slug: string; userId: string; serverUrl: string };

export type SavedViewResultRequest = {
	userId: string;
	serverUrl: string;
	queryDocument: RyotQLDocument;
};

export type ManagedAssetResolutionRequest = {
	userId: string;
	serverUrl: string;
	assets: readonly ManagedAssetLocator[];
};

export const savedViewRecordRequestKey = (request: SavedViewRecordRequest) =>
	stableStringify([request.serverUrl, request.userId, request.slug]);

export const savedViewResultRequestKey = (request: SavedViewResultRequest) =>
	stableStringify([request.serverUrl, request.userId, request.queryDocument]);

export const canonicalManagedAssetRequest = (request: ManagedAssetResolutionRequest) => {
	const assets = [
		...new Map(request.assets.map((asset) => [`${asset.type}:${asset.key}`, asset])).values(),
	].sort((left, right) => `${left.type}:${left.key}`.localeCompare(`${right.type}:${right.key}`));
	return { assets, key: stableStringify([request.serverUrl, request.userId, assets]) };
};
