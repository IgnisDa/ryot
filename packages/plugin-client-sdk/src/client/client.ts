import {
	CleanupManagedAssetOutput,
	ManagedAssetLocator,
	ManagedAssetResolutionBatch,
	TemporaryUploadToken,
} from "@ryot-app/contract/modules/assets/schemas";
import {
	CollectionResponse,
	type CreateCollectionBody,
	type CreateMembershipBody,
	type DeleteMembershipBody,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import { EntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import type { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import {
	EntityWatch,
	ExternalLinkRequest,
	ExternalLinkSuccess,
	PluginCollectionRequest,
	PluginDeviceRequest,
	PluginDeviceResult,
	PluginManagedAssetResolution,
	PluginStorageRequest,
	PluginThemeSnapshot,
	ProviderSearchScreenOutcome,
	ProviderSearchScreenRequest,
} from "@ryot-app/plugin-client-contract";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import type {
	EntityUpdate,
	EntityWatchSubscription,
	OperationInvocation,
	PermanentUploadRequest,
	RyotClientAdapter,
	RyotPageSearchUpdate,
	RyotProviderSearchScreenRequest,
	TemporaryUploadRequest,
} from "./adapter";
import { asTransportError, RyotClientError } from "./errors";
import type { RyotNavigationTarget } from "./navigation-target";

const normalizeInterest = (interest: EntityWatch): EntityWatch => {
	const decoded = Schema.decodeResult(EntityWatch)(interest);
	if (Result.isFailure(decoded)) {
		throw new RyotClientError("invalid-input");
	}
	const foreground = [...new Set(decoded.success.foreground)].sort();
	const roots = new Set(foreground);
	const visible = [...new Set(decoded.success.visible)].filter((id) => !roots.has(id)).sort();
	return { visible, foreground };
};

const decodeCapability = <A>(
	schema: Schema.Codec<A, unknown>,
	value: unknown,
): Effect.Effect<A, RyotClientError> => {
	const decoded = Schema.decodeUnknownResult(schema)(value);
	return Result.isFailure(decoded)
		? Effect.fail(new RyotClientError("malformed-result"))
		: Effect.succeed(decoded.success);
};

const adapterEffect = (call: () => Effect.Effect<unknown, RyotClientError>) =>
	Effect.flatMap(Effect.try({ try: call, catch: asTransportError }), (effect) =>
		Effect.mapError(effect, asTransportError),
	);

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
	const mutateCollection = <Output extends Schema.Codec<unknown, unknown>>(
		request: unknown,
		outputSchema: Output,
	): Effect.Effect<Output["Type"], RyotClientError> =>
		Effect.gen(function* () {
			const decodedRequest = Schema.decodeUnknownResult(PluginCollectionRequest)(request);
			if (Result.isFailure(decodedRequest)) {
				return yield* new RyotClientError("invalid-input");
			}
			const mutate = adapter.mutateCollection;
			if (!mutate) {
				return yield* new RyotClientError("unsupported-capability");
			}
			const value = yield* adapterEffect(() => mutate(decodedRequest.success));
			const decoded = yield* decodeCapability(outputSchema, value);
			mutationCompleted.hint();
			return decoded;
		});
	const accessStorage = (request: unknown): Effect.Effect<JsonValue | null, RyotClientError> =>
		Effect.gen(function* () {
			const decodedRequest = Schema.decodeUnknownResult(PluginStorageRequest)(request);
			if (Result.isFailure(decodedRequest)) {
				return yield* new RyotClientError("invalid-input");
			}
			const access = adapter.accessStorage;
			if (!access) {
				return yield* new RyotClientError("unsupported-capability");
			}
			const value = yield* adapterEffect(() => access(decodedRequest.success));
			if (value !== null && !isJsonValue(value)) {
				return yield* new RyotClientError("malformed-result");
			}
			return value;
		});
	let themeSnapshotInput: unknown;
	let themeSnapshot: PluginThemeSnapshot | undefined;
	const decodeThemeSnapshot = (value: unknown): PluginThemeSnapshot => {
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
		const decoded = Schema.decodeResult(ProviderSearchScreenRequest)(request);
		if (Result.isFailure(decoded)) {
			return Effect.fail(new RyotClientError("invalid-input"));
		}
		const open = adapter.openProviderSearch;
		if (!open) {
			return Effect.fail(new RyotClientError("unsupported-capability"));
		}
		return adapterEffect(() => open(decoded.success)).pipe(
			Effect.flatMap((outcome) => decodeCapability(ProviderSearchScreenOutcome, outcome)),
		);
	};
	const uploadFile = <A>(
		action: "temporary" | "permanent",
		request: TemporaryUploadRequest | PermanentUploadRequest,
		output: Schema.Codec<A, unknown>,
	): Effect.Effect<A, RyotClientError> =>
		Effect.gen(function* () {
			if (!(request.source instanceof Blob)) {
				return yield* new RyotClientError("invalid-input");
			}
			const uploadRequest =
				action === "temporary"
					? { ...request, action: "temporary" as const }
					: { ...request, action: "permanent" as const };
			const value = yield* adapterEffect(() => adapter.upload(uploadRequest));
			return yield* decodeCapability(output, value);
		});
	const cleanupUpload = (
		asset: ManagedAssetLocator,
	): Effect.Effect<CleanupManagedAssetOutput, RyotClientError> =>
		Effect.gen(function* () {
			const decodedAsset = Schema.decodeResult(ManagedAssetLocator)(asset);
			if (Result.isFailure(decodedAsset)) {
				return yield* new RyotClientError("invalid-input");
			}
			const value = yield* adapterEffect(() =>
				adapter.upload({ action: "cleanup", asset: decodedAsset.success }),
			);
			return yield* decodeCapability(CleanupManagedAssetOutput, value);
		});

	return {
		overlayBack,
		mutationCompleted,
		screens: { openProviderSearch },
		pluginIdentity: (packageId: PluginPackageId) => {
			if (!adapter.pluginIdentity) {
				throw new RyotClientError("invalid-request");
			}
			return adapter.pluginIdentity(packageId);
		},
		persistence: {
			registerFlush: (flush: () => Effect.Effect<void, RyotClientError>) => {
				if (!adapter.registerFlush) {
					throw new RyotClientError("unsupported-capability");
				}
				return adapter.registerFlush(flush);
			},
		},
		uploads: {
			cleanup: cleanupUpload,
			uploadPermanent: (request: PermanentUploadRequest) =>
				uploadFile("permanent", request, ManagedAssetLocator),
			uploadTemporary: (request: TemporaryUploadRequest) =>
				uploadFile("temporary", request, TemporaryUploadToken),
		},
		navigation: {
			push: (target: RyotNavigationTarget) => navigate("push", target),
			replace: (target: RyotNavigationTarget) => navigate("replace", target),
			pageSearch: {
				push: (update: RyotPageSearchUpdate) => navigatePageSearch("push", update),
				replace: (update: RyotPageSearchUpdate) => navigatePageSearch("replace", update),
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
		storage: {
			get: (pluginId: PluginId, key: string) => accessStorage({ key, pluginId, action: "get" }),
			remove: (pluginId: PluginId, key: string) =>
				Effect.asVoid(accessStorage({ key, pluginId, action: "remove" })),
			set: (pluginId: PluginId, key: string, value: JsonValue) =>
				Effect.asVoid(accessStorage({ key, value, pluginId, action: "set" })),
		},
		collections: {
			create: (input: typeof CreateCollectionBody.Encoded) =>
				mutateCollection({ input, action: "create" }, CollectionResponse),
			upsertMembership: (input: typeof CreateMembershipBody.Encoded) =>
				mutateCollection({ input, action: "upsert-membership" }, MembershipResponse),
			removeMembership: (input: typeof DeleteMembershipBody.Encoded) =>
				mutateCollection({ input, action: "remove-membership" }, MembershipResponse),
		},
		data: {
			query: <Success>(recipe: PreparedRecipe<Success>): Effect.Effect<Success, RyotClientError> =>
				Effect.gen(function* () {
					const response = yield* adapterEffect(() => adapter.query(recipe.document));
					const decoded = yield* Effect.try({
						try: () => recipe.decode(response),
						catch: () => new RyotClientError("malformed-result"),
					});
					if (Result.isFailure(decoded)) {
						return yield* new RyotClientError("malformed-result");
					}
					return decoded.success;
				}),
		},
		device: (request: PluginDeviceRequest): Effect.Effect<PluginDeviceResult, RyotClientError> =>
			Effect.gen(function* () {
				const decoded = Schema.decodeResult(PluginDeviceRequest)(request);
				if (Result.isFailure(decoded)) {
					return yield* new RyotClientError("invalid-input");
				}
				const device = adapter.device;
				if (!device) {
					return yield* new RyotClientError("unsupported-capability");
				}
				return yield* decodeCapability(
					PluginDeviceResult,
					yield* adapterEffect(() => device(decoded.success)),
				);
			}),
		links: {
			open: (request: Schema.Codec.Encoded<typeof ExternalLinkRequest>) =>
				Effect.gen(function* () {
					const decoded = Schema.decodeResult(ExternalLinkRequest)(request);
					if (Result.isFailure(decoded)) {
						return yield* new RyotClientError("invalid-request");
					}
					const open = adapter.openExternalLink;
					if (!open) {
						return yield* new RyotClientError("unsupported-capability");
					}
					const value = yield* adapterEffect(() => open(decoded.success));
					return yield* decodeCapability(ExternalLinkSuccess, value);
				}),
		},
		operations: {
			invoke: <Output extends Schema.Codec<unknown, unknown>>(
				request: OperationInvocation<Output>,
			): Effect.Effect<Output["Type"], RyotClientError> =>
				Effect.gen(function* () {
					if (!isJsonValue(request.input)) {
						return yield* new RyotClientError("invalid-input");
					}
					const invoke = adapter.invokeOperation;
					if (!invoke) {
						return yield* new RyotClientError("unsupported-capability");
					}
					const value = yield* adapterEffect(() =>
						invoke({ slug: request.slug, input: request.input, packageId: request.packageId }),
					);
					if (!isJsonValue(value)) {
						return yield* new RyotClientError("malformed-result");
					}
					const decoded = yield* decodeCapability(request.output, value);
					if (request.refreshOnSuccess !== false) {
						mutationCompleted.hint();
					}
					return decoded;
				}),
		},
		assets: {
			resolve: (assets: readonly ManagedAssetLocator[]) =>
				Effect.gen(function* () {
					const decodedAssets = Schema.decodeResult(ManagedAssetResolutionBatch)(assets);
					if (Result.isFailure(decodedAssets)) {
						return yield* new RyotClientError("invalid-input");
					}
					const resolve = adapter.resolveAssets;
					if (!resolve) {
						return yield* new RyotClientError("unsupported-capability");
					}
					const value = yield* adapterEffect(() => resolve(decodedAssets.success));
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
						return yield* new RyotClientError("malformed-result");
					}
					return decoded.success;
				}),
		},
		entities: {
			watch: (
				interest: EntityWatch,
				onUpdate: (update: EntityUpdate) => void,
			): EntityWatchSubscription => {
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
						const decoded = Schema.decodeResult(EntityUpdatedMessage)(value);
						if (Result.isFailure(decoded)) {
							throw new RyotClientError("malformed-result");
						}
						onUpdate({ reason: decoded.success.reason, entityId: decoded.success.entityId });
					});
					return {
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
					};
				} catch (error) {
					throw asTransportError(error);
				}
			},
		},
	};
};

export type RyotClient = ReturnType<typeof createRyotClient>;
