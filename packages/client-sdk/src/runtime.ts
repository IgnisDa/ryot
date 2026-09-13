import {
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	PLUGIN_HEADER_TITLE_MAX,
	PluginBridgeHostMessage,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeCollectionRequest,
	type PluginBridgeDismissOverlayResult,
	type PluginBridgeHeader,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type ClientPageContext,
	type KernelShortcut,
	type PluginBridgeKernelShortcut,
	type PluginBridgeNavigate,
	type PluginBridgeNavigateBack,
	type PluginBridgeOpenDrawer,
	type PluginBridgeOperationRequest,
	type PluginBridgePageSearch,
	type PluginBridgeProviderSearchScreen,
	type PluginBridgeReady,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeScreenState,
	type PluginBridgeOverlayState,
	type PluginBridgePageShortcuts,
	type PluginBridgeUploadRequest,
	type PluginClientArtifactMetadata,
	type PluginThemeSnapshot,
	type RyotClientErrorReason,
} from "@ryot-app/client-plugin-contract";
import { MAX_INTEREST_ENTITY_IDS } from "@ryot-app/contract/modules/entity-interest/messages";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { EntityId, EntitySchemaSlug, PluginSlug } from "@ryot-app/contract/schema/brands";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Match, Result, Schema } from "effect";

import {
	createRyotClient,
	RyotClientError,
	type OperationAdapterRequest,
	type CollectionAdapterRequest,
	type RyotPageSearchUpdate,
	type RyotProviderSearchScreenRequest,
	type RyotNavigationTarget,
	type EntityInterest,
	type EntityUpdate,
	type TemporaryUploadRequest,
} from "./index";
import type { PluginNavigationController, PluginNavigationSnapshot } from "./navigation/store";

type PluginRuntimeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingCall = {
	readonly cleanup?: () => void;
	readonly reject: (error: unknown) => void;
	readonly resolve: (value: unknown) => void;
};

type PluginThemeRoot = { readonly setAttribute: (name: string, value: string) => void };

const decodeHostMessage = Schema.decodeUnknownResult(PluginBridgeHostMessage);
const noOverlayToDismiss = () => false;

const normalizeHeaderTitle = (title: string) => {
	const trimmed = title.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return trimmed.length > PLUGIN_HEADER_TITLE_MAX
		? trimmed.slice(0, PLUGIN_HEADER_TITLE_MAX)
		: trimmed;
};

export const createPluginRuntime = (
	port: MessagePort,
	init: PluginBridgeInit,
	metadata: PluginClientArtifactMetadata,
	root: PluginThemeRoot,
	navigationStore: PluginNavigationController,
	onActive?: () => void,
	onTerminal?: () => void,
	onDocument?: (documentKey: string, page: ClientPageContext | undefined) => void,
) => {
	let hasLocation = false;
	let theme: PluginThemeSnapshot = { resolvedMode: init.mode };
	let nextRequestId = 0;
	let state: PluginRuntimeState = "ready";
	let terminalReason: RyotClientErrorReason | undefined;
	let dismissOverlay = noOverlayToDismiss;
	let overlayCount = 0;
	const listeners = new AbortController();
	const navigation = {
		subscribe: navigationStore.subscribe,
		getSnapshot: navigationStore.getSnapshot,
		completeTransition: navigationStore.completeTransition,
		back: () => post({ type: "navigate-back" } satisfies PluginBridgeNavigateBack),
		openDrawer: () => post({ type: "open-drawer" } satisfies PluginBridgeOpenDrawer),
		publishTitle: (title: string | null) => {
			const entry = navigationStore.getSnapshot().entry;
			if (entry === undefined) {
				return;
			}
			const published = title === null ? null : normalizeHeaderTitle(title);
			post({
				key: entry.key,
				type: "header",
				index: entry.index,
				header: published === null ? null : { title: published },
			} satisfies PluginBridgeHeader);
		},
		registerShortcut: (shortcut: string, press: () => void) => {
			const handlers = pageShortcuts.get(shortcut) ?? new Set<() => void>();
			if (!pageShortcuts.has(shortcut)) {
				pageShortcuts.set(shortcut, handlers);
				handlers.add(press);
				publishPageShortcuts();
			} else {
				handlers.add(press);
			}
			return () => {
				if (!handlers.delete(press) || handlers.size > 0) {
					return;
				}
				pageShortcuts.delete(shortcut);
				publishPageShortcuts();
			};
		},
	};
	const pageShortcuts = new Map<string, Set<() => void>>();
	const publishPageShortcuts = () => {
		if (state === "active") {
			post({
				type: "page-shortcuts",
				shortcuts: [...pageShortcuts.keys()].sort(),
			} satisfies PluginBridgePageShortcuts);
		}
	};
	const applyThemeMode = (mode: PluginThemeSnapshot["resolvedMode"]) =>
		root.setAttribute("data-theme", mode);
	const themeListeners = new Set<() => void>();
	const assets = new Map<string, PendingCall>();
	const collections = new Map<string, PendingCall>();
	const queries = new Map<string, PendingCall>();
	const uploads = new Map<string, PendingCall>();
	const operations = new Map<string, PendingCall>();
	const interestOwners = new Set<{
		interest: EntityInterest;
		onUpdate: (update: EntityUpdate) => void;
	}>();
	let postedInterest = JSON.stringify({ visible: [], foreground: [] });
	const publishInterest = () => {
		const roots = new Set([...interestOwners].flatMap(({ interest }) => interest.foreground));
		const foreground = [...roots].sort().slice(0, MAX_INTEREST_ENTITY_IDS);
		const visible = [...new Set([...interestOwners].flatMap(({ interest }) => interest.visible))]
			.filter((id) => !roots.has(id))
			.sort()
			.slice(0, MAX_INTEREST_ENTITY_IDS - foreground.length);
		const serialized = JSON.stringify({ visible, foreground });
		if (serialized === postedInterest) {
			return;
		}
		if (!post({ visible, foreground, type: "entity-interest" })) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		postedInterest = serialized;
	};

	const activate = () => {
		if (state === "ready" && hasLocation) {
			state = "active";
			onActive?.();
		}
	};

	const rejectPending = (reason: RyotClientErrorReason) => {
		const pendingCalls = [
			...collections.values(),
			...operations.values(),
			...queries.values(),
			...assets.values(),
			...uploads.values(),
		];
		operations.clear();
		collections.clear();
		queries.clear();
		assets.clear();
		uploads.clear();
		for (const pending of pendingCalls) {
			pending.cleanup?.();
			pending.reject(new RyotClientError(reason));
		}
	};
	const resetDocument = () => {
		rejectPending("disposed");
		pageShortcuts.clear();
		publishPageShortcuts();
		dismissOverlay = noOverlayToDismiss;
		overlayCount = 0;
		post({ count: 0, type: "overlay-state" } satisfies PluginBridgeOverlayState);
		interestOwners.clear();
		publishInterest();
		navigation.publishTitle(null);
	};

	const finish = (next: "failed" | "disposed", reason: RyotClientErrorReason, notify: boolean) => {
		if (state === "failed" || state === "disposed" || state === "closing") {
			return;
		}
		state = "closing";
		terminalReason = reason;
		rejectPending(reason);
		themeListeners.clear();
		interestOwners.clear();
		hasLocation = false;
		navigationStore.clear();
		if (notify) {
			try {
				port.postMessage({ reason: next, type: "lifecycle-close" });
			} catch {
				// The transport is already unavailable.
			}
		}
		listeners.abort();
		try {
			port.close();
		} catch {
			// The transport is already unavailable.
		}
		state = next;
		onTerminal?.();
	};

	const post = (message: unknown) => {
		try {
			port.postMessage(message);
			return true;
		} catch {
			finish("failed", "transport", false);
			return false;
		}
	};

	const admit = (pending: Map<string, PendingCall>, requestId: string, call: PendingCall) => {
		if (
			operations.size + collections.size + queries.size + assets.size + uploads.size >=
			CLIENT_BRIDGE_MAX_PENDING_REQUESTS
		) {
			finish("failed", "protocol", true);
			call.reject(new RyotClientError("protocol"));
			return false;
		}
		pending.set(requestId, call);
		return true;
	};

	const query = (document: PreparedRecipe<unknown>["document"], signal?: AbortSignal) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotClientError(terminalReason ?? "transport"));
				return;
			}
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			nextRequestId += 1;
			const requestId = `ryotql-${nextRequestId}`;
			const onAbort = () => {
				if (!queries.delete(requestId)) {
					return;
				}
				signal?.removeEventListener("abort", onAbort);
				reject(signal?.reason);
				post({ requestId, type: "ryotql-cancel" } satisfies PluginBridgeRyotQLCancel);
			};
			if (
				!admit(queries, requestId, {
					reject,
					resolve,
					cleanup: () => signal?.removeEventListener("abort", onAbort),
				})
			) {
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			post({ document, requestId, type: "ryotql-request" } satisfies PluginBridgeRyotQLRequest);
		});

	const resolveAssets = (requested: readonly ManagedAssetLocator[], signal?: AbortSignal) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotClientError(terminalReason ?? "transport"));
				return;
			}
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			nextRequestId += 1;
			const requestId = `asset-${nextRequestId}`;
			const onAbort = () => {
				if (!assets.delete(requestId)) {
					return;
				}
				signal?.removeEventListener("abort", onAbort);
				reject(signal?.reason);
				post({ requestId, type: "asset-cancel" } satisfies PluginBridgeAssetCancel);
			};
			if (
				!admit(assets, requestId, {
					reject,
					resolve,
					cleanup: () => signal?.removeEventListener("abort", onAbort),
				})
			) {
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			post({
				requestId,
				type: "asset-request",
				assets: [...requested],
			} satisfies PluginBridgeAssetRequest);
		});

	const invokeOperation = (request: OperationAdapterRequest) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotClientError(terminalReason ?? "transport"));
				return;
			}
			nextRequestId += 1;
			const requestId = `operation-${nextRequestId}`;
			if (!admit(operations, requestId, { reject, resolve })) {
				return;
			}
			post({
				requestId,
				input: request.input,
				type: "operation-request",
				operationSlug: request.slug,
				pluginSlug: PluginSlug.make(request.pluginSlug),
			} satisfies PluginBridgeOperationRequest);
		});

	const mutateCollection = (request: CollectionAdapterRequest) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotClientError(terminalReason ?? "transport"));
				return;
			}
			nextRequestId += 1;
			const requestId = `collection-${nextRequestId}`;
			if (!admit(collections, requestId, { reject, resolve })) {
				return;
			}
			post({
				...request,
				requestId,
				type: "collection-request",
			} satisfies PluginBridgeCollectionRequest);
		});

	const uploadTemporary = (request: TemporaryUploadRequest) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotClientError(terminalReason ?? "transport"));
				return;
			}
			nextRequestId += 1;
			const requestId = `upload-${nextRequestId}`;
			if (!admit(uploads, requestId, { reject, resolve })) {
				return;
			}
			post({
				requestId,
				source: request.source,
				type: "upload-request",
				fileName: request.fileName,
				contentType: request.contentType,
			} satisfies PluginBridgeUploadRequest);
		});

	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		const target = Match.value(to).pipe(
			Match.when({ kind: "plugin-route" }, ({ path, search, pluginSlug }) => ({
				path,
				kind: "plugin-route" as const,
				pluginSlug: PluginSlug.make(pluginSlug),
				search: search === undefined ? "" : new URLSearchParams(search).toString(),
			})),
			Match.when({ kind: "entity" }, ({ entityId }) => ({
				kind: "entity" as const,
				entityId: EntityId.make(entityId),
			})),
			Match.when({ kind: "saved-view" }, ({ slug }) => ({ slug, kind: "saved-view" as const })),
			Match.when({ kind: "kernel-page" }, ({ page }) => ({ page, kind: "kernel-page" as const })),
			Match.exhaustive,
		);
		if (!post({ mode, target, type: "navigate" } satisfies PluginBridgeNavigate)) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
	};
	const navigatePageSearch = (mode: "push" | "replace", update: RyotPageSearchUpdate) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		if (!post({ mode, update, type: "page-search" } satisfies PluginBridgePageSearch)) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
	};
	const openProviderSearch = (request: RyotProviderSearchScreenRequest) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		if (
			!post({
				...request,
				type: "provider-search-screen",
				entitySchemaSlug: EntitySchemaSlug.make(request.entitySchemaSlug),
			} satisfies PluginBridgeProviderSearchScreen)
		) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
	};

	const client = createRyotClient({
		query,
		navigate,
		resolveAssets,
		invokeOperation,
		uploadTemporary,
		mutateCollection,
		navigatePageSearch,
		openProviderSearch,
		overlays: {
			setDismissHandler: (handler) => {
				dismissOverlay = handler;
			},
			setCount: (count) => {
				overlayCount = count;
				if (state === "active") {
					post({ count, type: "overlay-state" } satisfies PluginBridgeOverlayState);
				}
			},
		},
		theme: {
			getSnapshot: () => {
				if (state === "closing" || state === "failed" || state === "disposed") {
					throw new RyotClientError(terminalReason ?? "transport");
				}
				return theme;
			},
			subscribe: (listener) => {
				if (state === "closing" || state === "failed" || state === "disposed") {
					throw new RyotClientError(terminalReason ?? "transport");
				}
				themeListeners.add(listener);
				return () => themeListeners.delete(listener);
			},
		},
		watchEntities: (interest, onUpdate) => {
			if (state !== "active") {
				throw new RyotClientError(terminalReason ?? "transport");
			}
			const owner = { interest, onUpdate };
			interestOwners.add(owner);
			publishInterest();
			return {
				dispose: () => {
					if (interestOwners.delete(owner)) {
						publishInterest();
					}
				},
				update: (next) => {
					if (state !== "active") {
						throw new RyotClientError(terminalReason ?? "transport");
					}
					owner.interest = next;
					publishInterest();
				},
			};
		},
	});

	const fatal = () => finish("failed", "protocol", true);
	const forwardKernelShortcut = (shortcut: KernelShortcut) => {
		if (state === "active") {
			post({ shortcut, type: "kernel-shortcut" } satisfies PluginBridgeKernelShortcut);
		}
	};
	const acceptLocation = ({
		key,
		index,
		compact,
		leading,
		edgeBack,
		location,
	}: Omit<PluginBridgeLocation, "type">) => {
		let accepted: PluginNavigationSnapshot;
		try {
			accepted = navigationStore.setLocation({
				leading,
				compact,
				edgeBack,
				entry: { key, index, location },
			});
		} catch {
			finish("failed", "protocol", true);
			return;
		}
		if (state !== "ready" && state !== "active") {
			return;
		}
		const acceptedEntry = accepted.entry;
		if (acceptedEntry === undefined) {
			finish("failed", "protocol", true);
			return;
		}
		if (
			!post({
				type: "screen-state",
				key: acceptedEntry.key,
				index: acceptedEntry.index,
				hasPreviousScreen: accepted.screens.length > 1,
			} satisfies PluginBridgeScreenState)
		) {
			return;
		}
		const activating = state === "ready";
		hasLocation = true;
		activate();
		if (activating && overlayCount > 0) {
			post({ count: overlayCount, type: "overlay-state" } satisfies PluginBridgeOverlayState);
		}
	};

	port.addEventListener(
		"message",
		(event) => {
			if (state === "failed" || state === "disposed" || state === "closing") {
				return;
			}
			const decoded = decodeHostMessage(event.data);
			if (Result.isFailure(decoded)) {
				finish("failed", "protocol", true);
				return;
			}
			Match.value(decoded.success).pipe(
				Match.when({ type: "document" }, ({ page, documentKey, navigation: nextNavigation }) => {
					resetDocument();
					onDocument?.(documentKey, page);
					acceptLocation(nextNavigation);
				}),
				Match.when({ type: "dismiss-overlay" }, ({ requestId }) => {
					let dismissed = false;
					try {
						dismissed = dismissOverlay();
					} catch {
						// A failed overlay callback is acknowledged without taking down the document.
					}
					post({
						dismissed,
						requestId,
						type: "dismiss-overlay-result",
					} satisfies PluginBridgeDismissOverlayResult);
				}),
				Match.when({ type: "entity-updated" }, ({ reason, entityId }) => {
					for (const owner of Array.from(interestOwners)) {
						if (
							interestOwners.has(owner) &&
							(owner.interest.foreground.includes(entityId) ||
								owner.interest.visible.includes(entityId))
						) {
							owner.onUpdate({ reason, entityId });
						}
					}
				}),
				Match.when({ type: "location" }, (location) => acceptLocation(location)),
				Match.when({ type: "viewport" }, ({ safeAreaTop, safeAreaBottom }) =>
					navigationStore.setViewport({ safeAreaTop, safeAreaBottom }),
				),
				Match.when({ type: "theme" }, ({ mode }) => {
					applyThemeMode(mode);
					theme = { resolvedMode: mode };
					for (const listener of themeListeners) {
						listener();
					}
				}),
				Match.when({ type: "page-refresh" }, () => {
					client.mutationCompleted.hint();
				}),
				Match.when({ type: "page-shortcut-press" }, ({ shortcut }) => {
					for (const press of pageShortcuts.get(shortcut) ?? []) {
						press();
					}
				}),
				Match.when({ type: "lifecycle-close" }, ({ reason }) =>
					finish(reason, reason === "disposed" ? "disposed" : "protocol", false),
				),
				Match.when({ type: "operation-result" }, (result) => {
					const pending = operations.get(result.requestId);
					if (!pending || !operations.delete(result.requestId)) {
						return;
					}
					pending.cleanup?.();
					if (result.outcome === "failure") {
						pending.reject(new RyotClientError(result.reason));
					} else {
						pending.resolve(result.value);
					}
				}),
				Match.when({ type: "collection-result" }, (result) => {
					const pending = collections.get(result.requestId);
					if (!pending || !collections.delete(result.requestId)) {
						return;
					}
					if (result.outcome === "failure") {
						pending.reject(new RyotClientError(result.reason));
					} else {
						pending.resolve(result.response);
					}
				}),
				Match.when({ type: "upload-result" }, (result) => {
					const pending = uploads.get(result.requestId);
					if (!pending || !uploads.delete(result.requestId)) {
						return;
					}
					pending.cleanup?.();
					if (result.outcome === "failure") {
						pending.reject(new RyotClientError(result.reason));
					} else {
						pending.resolve(result.token);
					}
				}),
				Match.when({ type: "asset-result" }, (result) => {
					const pending = assets.get(result.requestId);
					if (!pending || !assets.delete(result.requestId)) {
						return;
					}
					pending.cleanup?.();
					if (result.outcome === "failure") {
						pending.reject(new RyotClientError(result.reason));
					} else {
						pending.resolve(result.resolutions);
					}
				}),
				Match.when({ type: "ryotql-result" }, (result) => {
					const pending = queries.get(result.requestId);
					if (!pending || !queries.delete(result.requestId)) {
						return;
					}
					pending.cleanup?.();
					if (result.outcome === "failure") {
						pending.reject(new RyotClientError(result.reason));
					} else {
						pending.resolve(result.response);
					}
				}),
				Match.exhaustive,
			);
		},
		{ signal: listeners.signal },
	);
	port.addEventListener("messageerror", () => finish("failed", "transport", true), {
		signal: listeners.signal,
	});
	applyThemeMode(init.mode);
	navigationStore.setViewport({
		safeAreaTop: init.safeAreaTop,
		safeAreaBottom: init.safeAreaBottom,
	});

	try {
		port.start();
		post({
			format: metadata.format,
			sessionId: init.sessionId,
			artifactHash: metadata.hash,
			apiVersion: metadata.apiVersion,
			bridgeVersion: metadata.bridgeVersion,
			compilerVersion: metadata.compilerVersion,
		} satisfies PluginBridgeReady);
	} catch {
		finish("failed", "transport", false);
	}

	return {
		fatal,
		client,
		navigation,
		page: init.page,
		forwardKernelShortcut,
		dispose: () => finish("disposed", "disposed", true),
	};
};
