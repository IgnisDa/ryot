import type { DownloadResolutionResponse } from "@ryot/contract/modules/uploads/schemas";
import {
	decodeSavedViewRecordResponse,
	type SavedViewRecord,
} from "@ryot/ryotql-recipes/saved-view-records";
import type { Cause } from "effect";
import { Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import {
	collectManagedAssets,
	decodeSavedViewCardData,
	decodeSavedViewTableData,
	resolvedAssetUrls,
	type SavedViewCardItem,
	type SavedViewDisplayData,
	type SavedViewTableItem,
} from "./display-data";
import type { SavedViewLayout } from "./saved-view-layout-selector";

export type SavedViewError = {
	readonly title: string;
	readonly detail: string;
};

export type SavedViewRecordState =
	| { readonly status: "loading" }
	| { readonly status: "not-found" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "ready"; readonly record: SavedViewRecord }
	| { readonly status: "transport-error"; readonly cause: Cause.Cause<unknown> };

export type SavedViewActiveData =
	| { readonly layout: "grid"; readonly data: SavedViewDisplayData<SavedViewCardItem> }
	| { readonly layout: "list"; readonly data: SavedViewDisplayData<SavedViewCardItem> }
	| { readonly layout: "table"; readonly data: SavedViewDisplayData<SavedViewTableItem> };

export type SavedViewResultState =
	| { readonly status: "loading" }
	| { readonly status: "malformed"; readonly cause: unknown }
	| { readonly status: "transport-error"; readonly cause: Cause.Cause<unknown> }
	| ({
			readonly status: "ready";
			readonly entityIds: readonly string[];
			readonly assets: ReturnType<typeof collectManagedAssets>;
	  } & SavedViewActiveData);

export type SavedViewManagedAssetsState =
	| { readonly status: "ready"; readonly urls: ReadonlyMap<string, string> }
	| { readonly status: "loading"; readonly urls: ReadonlyMap<string, string> }
	| {
			readonly status: "unavailable";
			readonly cause: Cause.Cause<unknown>;
			readonly urls: ReadonlyMap<string, string>;
	  };

export const savedViewError = (state: {
	readonly status: "transport-error" | "malformed";
}): SavedViewError =>
	state.status === "transport-error"
		? {
				title: "Unable to load saved view",
				detail: "The server could not load this saved view. Check your connection and try again.",
			}
		: {
				title: "Unable to display saved view",
				detail: "The saved view returned data that could not be displayed. Try again later.",
			};

export const mapSavedViewRecord = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause } as const;
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" } as const;
	}
	const decoded = decodeSavedViewRecordResponse(result.value);
	if (Result.isFailure(decoded)) {
		return { status: "malformed", cause: decoded.failure } as const;
	}
	return decoded.success === null
		? ({ status: "not-found" } as const)
		: ({ status: "ready", record: decoded.success } as const);
};

export const mapSavedViewResult = (
	result: AsyncResult.AsyncResult<unknown, unknown>,
	record: SavedViewRecord,
	layout: SavedViewLayout,
): SavedViewResultState => {
	if (AsyncResult.isFailure(result)) {
		return { status: "transport-error", cause: result.cause };
	}
	if (!AsyncResult.isSuccess(result)) {
		return { status: "loading" };
	}
	if (layout === "table") {
		const decoded = decodeSavedViewTableData(result.value, record.layouts.table);
		if (Result.isFailure(decoded)) {
			return { status: "malformed", cause: decoded.failure };
		}
		return {
			layout,
			status: "ready",
			data: decoded.success,
			assets: collectManagedAssets(decoded.success.items),
			entityIds: decoded.success.items.map((item) => item.entityId),
		};
	}
	const decoded = decodeSavedViewCardData(result.value, record.layouts[layout]);
	if (Result.isFailure(decoded)) {
		return { status: "malformed", cause: decoded.failure };
	}
	const data = decoded.success;
	return {
		data,
		layout,
		status: "ready",
		assets: collectManagedAssets(data.items),
		entityIds: data.items.map((item) => item.entityId),
	};
};

export const mapManagedAssetResolution = (
	result: AsyncResult.AsyncResult<DownloadResolutionResponse, unknown>,
	serverUrl: string,
): SavedViewManagedAssetsState => {
	if (AsyncResult.isSuccess(result)) {
		return { status: "ready", urls: resolvedAssetUrls(result.value, serverUrl) };
	}
	if (AsyncResult.isFailure(result)) {
		return { status: "unavailable", cause: result.cause, urls: new Map() };
	}
	return { status: "loading", urls: new Map() };
};
