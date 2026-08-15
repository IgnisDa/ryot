import {
	EntityInterest,
	PluginCollectionRequest,
	type PluginOperationRequest,
	type PluginPageSearchUpdate,
	ProviderSearchScreenRequest,
	type ProviderSearchScreenRequest as ProviderSearchScreenRequestValue,
	PluginThemeSnapshot,
	type PluginThemeSnapshot as PluginThemeSnapshotValue,
	PluginManagedAssetResolution,
	type PluginManagedAssetResolution as PluginManagedAssetResolutionValue,
	type RyotClientErrorReason,
} from "@ryot-app/client-plugin-contract";
import {
	CollectionResponse,
	type CreateCollectionBody,
	type CreateMembershipBody,
	type DeleteMembershipBody,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	EntitySyncState,
	PopulationStatus,
	TranslationStatus,
} from "@ryot-app/contract/modules/entities/schemas";
import { EntityUpdatedMessage } from "@ryot-app/contract/modules/entity-interest/messages";
import {
	AssetLocator,
	ManagedAssetResolutionBatch,
	type ManagedAssetLocator as ManagedAssetLocatorValue,
	TemporaryUploadToken,
} from "@ryot-app/contract/modules/uploads/schemas";
import { EntityId, PluginSlug, SavedViewId } from "@ryot-app/contract/schema/brands";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export type { EntitySettle, EntitySettleReason } from "./settle";
export type { RyotClientErrorReason } from "@ryot-app/client-plugin-contract";
export type { EntityInterest } from "@ryot-app/client-plugin-contract";
export type EntityUpdate = Schema.Codec.Encoded<typeof EntityUpdatedMessage>;
export type EntityInterestSubscription = {
	readonly dispose: () => void;
	readonly update: (interest: EntityInterest) => void;
};

const normalizeInterest = (interest: EntityInterest): EntityInterest => {
	const decoded = Schema.decodeUnknownResult(EntityInterest)(interest);
	if (Result.isFailure(decoded)) {
		throw new RyotClientError("invalid-input");
	}
	const foreground = [...new Set(decoded.success.foreground)].sort();
	const roots = new Set(foreground);
	const visible = [...new Set(decoded.success.visible)].filter((id) => !roots.has(id)).sort();
	return { visible, foreground };
};
export type {
	ManagedAssetLocator,
	TemporaryUploadToken,
} from "@ryot-app/contract/modules/uploads/schemas";
export { AssetLocator, EntitySyncState, PopulationStatus, TranslationStatus };

export type RyotThemeSnapshot = PluginThemeSnapshotValue;
export type ManagedAssetResolution = PluginManagedAssetResolutionValue;

export class RyotClientError extends Error {
	readonly reason: RyotClientErrorReason;

	constructor(reason: RyotClientErrorReason) {
		super(`Ryot client failed: ${reason}`);
		this.reason = reason;
	}
}

const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError("transport");

type OperationRequest = Schema.Codec.Encoded<typeof PluginOperationRequest>;
export type OperationAdapterRequest = Omit<OperationRequest, "operationSlug"> & {
	readonly slug: OperationRequest["operationSlug"];
};

export type CollectionAdapterRequest = PluginCollectionRequest;

export type RyotPageSearchUpdate = PluginPageSearchUpdate;
export type RyotProviderSearchScreenRequest = Schema.Codec.Encoded<
	typeof ProviderSearchScreenRequest
>;

export type OperationInvocation<Output extends Schema.Codec<unknown, unknown>> = Omit<
	OperationRequest,
	"operationSlug"
> & { readonly slug: string; readonly output: Output };

export type TemporaryUploadRequest = {
	readonly source: Blob;
	readonly fileName: string;
	readonly contentType: string;
};

export const RyotNavigationTarget = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("entity") }),
	strictStruct({ kind: Schema.Literal("saved-view"), savedViewId: SavedViewId }),
	strictStruct({
		path: Schema.String,
		pluginSlug: PluginSlug,
		kind: Schema.Literal("plugin-route"),
		search: Schema.optional(Schema.Record(Schema.String, Schema.String)),
	}),
]);

export type RyotNavigationTarget = Schema.Codec.Encoded<typeof RyotNavigationTarget>;

export type RyotClientAdapter = {
	readonly uploadTemporary: (request: TemporaryUploadRequest) => Promise<unknown>;
	readonly invokeOperation?: (request: OperationAdapterRequest) => Promise<unknown>;
	readonly openProviderSearch?: (request: ProviderSearchScreenRequestValue) => void;
	readonly mutateCollection?: (request: CollectionAdapterRequest) => Promise<unknown>;
	readonly navigate?: (mode: "push" | "replace", target: RyotNavigationTarget) => void;
	readonly navigatePageSearch?: (mode: "push" | "replace", update: RyotPageSearchUpdate) => void;
	readonly overlays?: {
		readonly setCount: (count: number) => void;
		readonly setDismissHandler: (handler: () => boolean) => void;
	};
	readonly watchEntities?: (
		interest: EntityInterest,
		onUpdate: (update: EntityUpdate) => void,
	) => EntityInterestSubscription;
	readonly query: (
		document: PreparedRecipe<unknown>["document"],
		signal?: AbortSignal,
	) => Promise<unknown>;
	readonly theme?: {
		readonly getSnapshot: () => unknown;
		readonly subscribe: (listener: () => void) => () => void;
	};
	readonly resolveAssets?: (
		assets: readonly ManagedAssetLocatorValue[],
		signal?: AbortSignal,
	) => Promise<unknown>;
};

export const createRyotClient = (adapter: RyotClientAdapter) => {
	const overlays: Array<() => boolean> = [];
	adapter.overlays?.setDismissHandler(() => overlays.at(-1)?.() ?? false);
	const overlayBack = {
		register: (dismiss: () => boolean) => {
			overlays.push(dismiss);
			adapter.overlays?.setCount(overlays.length);
			return () => {
				const index = overlays.lastIndexOf(dismiss);
				if (index !== -1) {
					overlays.splice(index, 1);
					adapter.overlays?.setCount(overlays.length);
				}
			};
		},
	};
	const mutationCompletedListeners = new Set<() => void>();
	const mutationCompleted = {
		hint: () => {
			for (const listener of mutationCompletedListeners) {
				listener();
			}
		},
		subscribe: (listener: () => void) => {
			mutationCompletedListeners.add(listener);
			return () => {
				mutationCompletedListeners.delete(listener);
			};
		},
	};
	const mutateCollection = async <Output extends Schema.Codec<unknown, unknown>>(
		request: unknown,
		outputSchema: Output,
	): Promise<Output["Type"]> => {
		const decodedRequest = Schema.decodeUnknownResult(PluginCollectionRequest)(request);
		if (Result.isFailure(decodedRequest)) {
			throw new RyotClientError("invalid-input");
		}
		if (!adapter.mutateCollection) {
			throw new RyotClientError("unsupported-capability");
		}
		let value: unknown;
		try {
			value = await adapter.mutateCollection(decodedRequest.success);
		} catch (error) {
			throw asTransportError(error);
		}
		const decodedOutput = Schema.decodeUnknownResult(outputSchema)(value);
		if (Result.isFailure(decodedOutput)) {
			throw new RyotClientError("malformed-result");
		}
		mutationCompleted.hint();
		return decodedOutput.success;
	};
	let themeSnapshotInput: unknown;
	let themeSnapshot: PluginThemeSnapshotValue | undefined;
	const decodeThemeSnapshot = (value: unknown): PluginThemeSnapshotValue => {
		if (themeSnapshot && Object.is(value, themeSnapshotInput)) {
			return themeSnapshot;
		}
		const decoded = Schema.decodeUnknownResult(PluginThemeSnapshot)(value);
		if (Result.isFailure(decoded)) {
			throw new RyotClientError("malformed-result");
		}
		themeSnapshot = decoded.success;
		themeSnapshotInput = value;
		return themeSnapshot;
	};
	const getThemeSnapshot = () => {
		if (!adapter.theme) {
			throw new RyotClientError("unsupported-capability");
		}
		try {
			return decodeThemeSnapshot(adapter.theme.getSnapshot());
		} catch (error) {
			throw asTransportError(error);
		}
	};
	const navigate = (mode: "push" | "replace", target: RyotNavigationTarget) => {
		if (!adapter.navigate) {
			throw new RyotClientError("unsupported-capability");
		}
		try {
			adapter.navigate(mode, target);
		} catch (error) {
			throw asTransportError(error);
		}
	};
	const navigatePageSearch = (mode: "push" | "replace", update: RyotPageSearchUpdate) => {
		if (!adapter.navigatePageSearch) {
			throw new RyotClientError("unsupported-capability");
		}
		try {
			adapter.navigatePageSearch(mode, update);
		} catch (error) {
			throw asTransportError(error);
		}
	};
	const openProviderSearch = (request: RyotProviderSearchScreenRequest) => {
		const decoded = Schema.decodeUnknownResult(ProviderSearchScreenRequest)(request);
		if (Result.isFailure(decoded)) {
			throw new RyotClientError("invalid-input");
		}
		if (!adapter.openProviderSearch) {
			throw new RyotClientError("unsupported-capability");
		}
		try {
			adapter.openProviderSearch(decoded.success);
		} catch (error) {
			throw asTransportError(error);
		}
	};

	return {
		overlayBack,
		mutationCompleted,
		collections: {
			create: (input: typeof CreateCollectionBody.Encoded) =>
				mutateCollection({ action: "create", input }, CollectionResponse),
			upsertMembership: (input: typeof CreateMembershipBody.Encoded) =>
				mutateCollection({ action: "upsert-membership", input }, MembershipResponse),
			removeMembership: (input: typeof DeleteMembershipBody.Encoded) =>
				mutateCollection({ action: "remove-membership", input }, MembershipResponse),
		},
		screens: { openProviderSearch },
		entities: {
			watch: (
				interest: EntityInterest,
				onUpdate: (update: EntityUpdate) => void,
			): EntityInterestSubscription => {
				const normalized = normalizeInterest(interest);
				if (!adapter.watchEntities) {
					throw new RyotClientError("unsupported-capability");
				}
				let disposed = false;
				try {
					const subscription = adapter.watchEntities(normalized, (value) => {
						if (disposed) {
							return;
						}
						const decoded = Schema.decodeUnknownResult(EntityUpdatedMessage)(value);
						if (Result.isFailure(decoded)) {
							throw new RyotClientError("malformed-result");
						}
						onUpdate({ entityId: decoded.success.entityId, reason: decoded.success.reason });
					});
					return {
						update: (next) => {
							const normalizedNext = normalizeInterest(next);
							if (disposed) {
								throw new RyotClientError("disposed");
							}
							try {
								subscription.update(normalizedNext);
							} catch (error) {
								throw asTransportError(error);
							}
						},
						dispose: () => {
							if (disposed) {
								return;
							}
							disposed = true;
							try {
								subscription.dispose();
							} catch (error) {
								throw asTransportError(error);
							}
						},
					};
				} catch (error) {
					throw asTransportError(error);
				}
			},
		},
		navigation: {
			push: (target: RyotNavigationTarget) => navigate("push", target),
			replace: (target: RyotNavigationTarget) => navigate("replace", target),
			pageSearch: {
				push: (update: RyotPageSearchUpdate) => navigatePageSearch("push", update),
				replace: (update: RyotPageSearchUpdate) => navigatePageSearch("replace", update),
			},
		},
		assets: {
			resolve: async (
				assets: readonly ManagedAssetLocatorValue[],
				options?: { readonly signal?: AbortSignal },
			) => {
				if (options?.signal?.aborted) {
					throw options.signal.reason;
				}
				const decodedAssets = Schema.decodeUnknownResult(ManagedAssetResolutionBatch)(assets);
				if (Result.isFailure(decodedAssets)) {
					throw new RyotClientError("invalid-input");
				}
				if (!adapter.resolveAssets) {
					throw new RyotClientError("unsupported-capability");
				}
				let value: unknown;
				try {
					value = await adapter.resolveAssets(decodedAssets.success, options?.signal);
				} catch (error) {
					if (options?.signal?.aborted) {
						throw options.signal.reason;
					}
					throw asTransportError(error);
				}
				const decoded = Schema.decodeUnknownResult(Schema.Array(PluginManagedAssetResolution))(
					value,
				);
				if (
					Result.isFailure(decoded) ||
					decoded.success.length !== decodedAssets.success.length ||
					decoded.success.some((resolution, index) => {
						const requested = decodedAssets.success[index];
						return (
							requested === undefined ||
							resolution.asset.type !== requested.type ||
							resolution.asset.key !== requested.key
						);
					})
				) {
					throw new RyotClientError("malformed-result");
				}
				return decoded.success;
			},
		},
		data: {
			query: async <Success>(
				recipe: PreparedRecipe<Success>,
				options?: { readonly signal?: AbortSignal },
			) => {
				if (options?.signal?.aborted) {
					throw options.signal.reason;
				}
				let response: unknown;
				try {
					response = await adapter.query(recipe.document, options?.signal);
				} catch (error) {
					if (options?.signal?.aborted) {
						throw options.signal.reason;
					}
					throw asTransportError(error);
				}
				let decoded: ReturnType<typeof recipe.decode>;
				try {
					decoded = recipe.decode(response);
				} catch {
					throw new RyotClientError("malformed-result");
				}
				if (Result.isFailure(decoded)) {
					throw new RyotClientError("malformed-result");
				}
				return decoded.success;
			},
		},
		operations: {
			invoke: async <Output extends Schema.Codec<unknown, unknown>>(
				request: OperationInvocation<Output>,
			) => {
				if (!isJsonValue(request.input)) {
					throw new RyotClientError("invalid-input");
				}
				if (!adapter.invokeOperation) {
					throw new RyotClientError("unsupported-capability");
				}
				let value: unknown;
				try {
					value = await adapter.invokeOperation({
						slug: request.slug,
						input: request.input,
						pluginSlug: request.pluginSlug,
					});
				} catch (error) {
					throw asTransportError(error);
				}
				if (!isJsonValue(value)) {
					throw new RyotClientError("malformed-result");
				}
				const decoded = Schema.decodeUnknownResult(request.output)(value);
				if (Result.isFailure(decoded)) {
					throw new RyotClientError("malformed-result");
				}
				mutationCompleted.hint();
				return decoded.success;
			},
		},
		uploads: {
			uploadTemporary: async (request: TemporaryUploadRequest) => {
				if (!(request.source instanceof Blob)) {
					throw new RyotClientError("invalid-input");
				}
				let value: unknown;
				try {
					value = await adapter.uploadTemporary(request);
				} catch (error) {
					throw asTransportError(error);
				}
				const decoded = Schema.decodeUnknownResult(TemporaryUploadToken)(value);
				if (Result.isFailure(decoded)) {
					throw new RyotClientError("malformed-result");
				}
				return decoded.success;
			},
		},
		theme: {
			getSnapshot: getThemeSnapshot,
			subscribe: (listener: () => void) => {
				if (!adapter.theme) {
					throw new RyotClientError("unsupported-capability");
				}
				try {
					return adapter.theme.subscribe(() => {
						getThemeSnapshot();
						listener();
					});
				} catch (error) {
					throw asTransportError(error);
				}
			},
		},
	};
};

export type RyotClient = ReturnType<typeof createRyotClient>;
