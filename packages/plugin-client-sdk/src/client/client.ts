import type { CleanupManagedAssetOutput } from "@ryot-app/contract/modules/assets/schemas";
import {
	ManagedAssetLocator,
	ManagedAssetResolutionBatch,
} from "@ryot-app/contract/modules/assets/schemas";
import {
	CollectionResponse,
	type CreateCollectionBody,
	type CreateMembershipBody,
	type DeleteMembershipBody,
	MembershipResponse,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	EntityEditorSaveOutput,
	EntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import { EntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import type { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import {
	AddToCollectionOutcome,
	AddToCollectionRequest,
	EditCollectionOutcome,
	EditCollectionRequest,
	EntityWatch,
	ExternalLinkRequest,
	ExternalLinkSuccess,
	PluginCalendarSourceVisibilityRequest,
	PluginCollectionRequest,
	PluginDeviceRequest,
	PluginDeviceResult,
	PluginIosLiveActivityRequest,
	PluginIosLiveActivityResult,
	PluginManagedAssetResolution,
	PluginStorageRequest,
	PluginThemeSnapshot,
	type PluginUploadRequest,
	PluginUploadResult,
	PickEntityOutcome,
	PickEntityRequest,
} from "@ryot-app/plugin-client-contract";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import type {
	EntityUpdate,
	EntityWatchSubscription,
	FileUploadRequest,
	OperationInvocation,
	RyotClientAdapter,
	RyotAddToCollectionRequest,
	RyotEditCollectionRequest,
	RyotPageSearchUpdate,
	RyotPickEntityRequest,
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

const openScreen = <Request, Outcome>(
	requestSchema: Schema.Codec<Request, unknown>,
	outcomeSchema: Schema.Codec<Outcome, unknown>,
	open: ((request: Request) => Effect.Effect<unknown, RyotClientError>) | undefined,
	request: unknown,
): Effect.Effect<Outcome, RyotClientError> => {
	const decoded = Schema.decodeUnknownResult(requestSchema)(request);
	if (Result.isFailure(decoded)) {
		return Effect.fail(new RyotClientError("invalid-input"));
	}
	if (!open) {
		return Effect.fail(new RyotClientError("unsupported-capability"));
	}
	return adapterEffect(() => open(decoded.success)).pipe(
		Effect.flatMap((outcome) => decodeCapability(outcomeSchema, outcome)),
	);
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
	const setCalendarSourceVisibility = (
		request: Schema.Codec.Encoded<typeof PluginCalendarSourceVisibilityRequest>,
	): Effect.Effect<void, RyotClientError> =>
		Effect.gen(function* () {
			const decodedRequest = Schema.decodeResult(PluginCalendarSourceVisibilityRequest)(request);
			if (Result.isFailure(decodedRequest)) {
				return yield* new RyotClientError("invalid-input");
			}
			const setVisibility = adapter.setCalendarSourceVisibility;
			if (!setVisibility) {
				return yield* new RyotClientError("unsupported-capability");
			}
			yield* adapterEffect(() => setVisibility(decodedRequest.success));
			mutationCompleted.hint();
			return undefined;
		});
	const saveEntity = (
		request: Schema.Codec.Encoded<typeof EntityEditorSaveRequest>,
	): Effect.Effect<EntityEditorSaveOutput, RyotClientError> =>
		Effect.gen(function* () {
			const decodedRequest = Schema.decodeResult(EntityEditorSaveRequest)(request);
			if (Result.isFailure(decodedRequest)) {
				return yield* new RyotClientError("invalid-input");
			}
			const save = adapter.saveEntity;
			if (!save) {
				return yield* new RyotClientError("unsupported-capability");
			}
			const output = yield* decodeCapability(
				EntityEditorSaveOutput,
				yield* adapterEffect(() => save(decodedRequest.success)),
			);
			if (output.kind === "saved") {
				mutationCompleted.hint();
			}
			return output;
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
	const pickEntity = (request: RyotPickEntityRequest) =>
		openScreen(PickEntityRequest, PickEntityOutcome, adapter.pickEntity, request);
	const editCollection = (request: RyotEditCollectionRequest) =>
		openScreen(EditCollectionRequest, EditCollectionOutcome, adapter.editCollection, request);
	const addToCollection = (request: RyotAddToCollectionRequest) =>
		openScreen(AddToCollectionRequest, AddToCollectionOutcome, adapter.addToCollection, request);
	const requestUpload = (request: PluginUploadRequest) =>
		adapterEffect(() => adapter.upload(request)).pipe(
			Effect.flatMap((value) => decodeCapability(PluginUploadResult, value)),
		);
	const uploadFile = (action: "temporary" | "permanent", request: FileUploadRequest) =>
		request.source instanceof Blob
			? requestUpload({ ...request, action })
			: Effect.fail(new RyotClientError("invalid-input"));
	const uploadTemporary = (request: FileUploadRequest) =>
		Effect.flatMap(uploadFile("temporary", request), (result) =>
			result.action === "temporary"
				? Effect.succeed(result.token)
				: Effect.fail(new RyotClientError("malformed-result")),
		);
	const uploadPermanent = (request: FileUploadRequest) =>
		Effect.flatMap(uploadFile("permanent", request), (result) =>
			result.action === "permanent"
				? Effect.succeed(result.asset)
				: Effect.fail(new RyotClientError("malformed-result")),
		);
	const cleanupUpload = (
		asset: ManagedAssetLocator,
	): Effect.Effect<CleanupManagedAssetOutput, RyotClientError> => {
		const decodedAsset = Schema.decodeResult(ManagedAssetLocator)(asset);
		if (Result.isFailure(decodedAsset)) {
			return Effect.fail(new RyotClientError("invalid-input"));
		}
		return Effect.flatMap(
			requestUpload({ action: "cleanup", asset: decodedAsset.success }),
			(result) =>
				result.action === "cleanup"
					? Effect.succeed({ status: result.status })
					: Effect.fail(new RyotClientError("malformed-result")),
		);
	};
	const invokeIosLiveActivity = (
		request: PluginIosLiveActivityRequest,
	): Effect.Effect<PluginIosLiveActivityResult, RyotClientError> =>
		Effect.gen(function* () {
			const decoded = Schema.decodeResult(PluginIosLiveActivityRequest)(request);
			if (Result.isFailure(decoded)) {
				return yield* new RyotClientError("invalid-input");
			}
			const iosLiveActivity = adapter.iosLiveActivity;
			if (!iosLiveActivity) {
				return yield* new RyotClientError("unsupported-capability");
			}
			return yield* decodeCapability(
				PluginIosLiveActivityResult,
				yield* adapterEffect(() => iosLiveActivity(decoded.success)),
			);
		});

	return {
		overlayBack,
		mutationCompleted,
		screens: { pickEntity, editCollection, addToCollection },
		calendarSources: { setVisibility: setCalendarSourceVisibility },
		uploads: { uploadPermanent, uploadTemporary, cleanup: cleanupUpload },
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
		iosLiveActivities: {
			end: (
				request: Omit<Extract<PluginIosLiveActivityRequest, { readonly action: "end" }>, "action">,
			) => invokeIosLiveActivity({ ...request, action: "end" }),
			list: (
				request: Omit<Extract<PluginIosLiveActivityRequest, { readonly action: "list" }>, "action">,
			) => invokeIosLiveActivity({ ...request, action: "list" }),
			start: (
				request: Omit<
					Extract<PluginIosLiveActivityRequest, { readonly action: "start" }>,
					"action"
				>,
			) => invokeIosLiveActivity({ ...request, action: "start" }),
			update: (
				request: Omit<
					Extract<PluginIosLiveActivityRequest, { readonly action: "update" }>,
					"action"
				>,
			) => invokeIosLiveActivity({ ...request, action: "update" }),
			availability: (
				request: Omit<
					Extract<PluginIosLiveActivityRequest, { readonly action: "availability" }>,
					"action"
				>,
			) => invokeIosLiveActivity({ ...request, action: "availability" }),
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
		operations: {
			invoke: <
				Input extends Schema.Codec<unknown, unknown>,
				Output extends Schema.Codec<unknown, unknown>,
			>(
				request: OperationInvocation<Input, Output>,
			): Effect.Effect<Output["Type"], RyotClientError> =>
				Effect.gen(function* () {
					const input = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(request.inputSchema))(
						request.input,
					).pipe(Effect.mapError(() => new RyotClientError("invalid-input")));
					const invoke = adapter.invokeOperation;
					if (!invoke) {
						return yield* new RyotClientError("unsupported-capability");
					}
					const value = yield* adapterEffect(() =>
						invoke({
							input,
							slug: request.slug,
							packageId: request.packageId,
							...(request.idempotencyKey === undefined
								? {}
								: { idempotencyKey: request.idempotencyKey }),
						}),
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
		entities: {
			save: saveEntity,
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
