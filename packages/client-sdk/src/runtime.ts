import {
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	PLUGIN_HEADER_TITLE_MAX,
	PluginBridgeHostMessage,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeHeader,
	type PluginBridgeInit,
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
	type PluginBridgeUploadRequest,
	type PluginClientArtifactMetadata,
	type PluginThemeSnapshot,
	type RyotClientErrorReason,
} from "@ryot-app/client-plugin-contract";
import { MAX_INTEREST_ENTITY_IDS } from "@ryot-app/contract/modules/entity-interest/messages";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Match, Result, Schema } from "effect";

import {
	createRyotClient,
	RyotClientError,
	type OperationAdapterRequest,
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
) => {
	const page = init.page;
	let hasLocation = false;
	let theme: PluginThemeSnapshot = { resolvedMode: init.mode };
	let nextRequestId = 0;
	let state: PluginRuntimeState = "ready";
	let terminalReason: RyotClientErrorReason | undefined;
	const listeners = new AbortController();
	const navigation = {
		subscribe: navigationStore.subscribe,
		getSnapshot: navigationStore.getSnapshot,
		back: () => post({ type: "navigate-back" } satisfies PluginBridgeNavigateBack),
		openDrawer: () => post({ type: "open-drawer" } satisfies PluginBridgeOpenDrawer),
		completeTransition: navigationStore.completeTransition,
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
	};
	const applyThemeMode = (mode: PluginThemeSnapshot["resolvedMode"]) =>
		root.setAttribute("data-theme", mode);
	const themeListeners = new Set<() => void>();
	const assets = new Map<string, PendingCall>();
	const queries = new Map<string, PendingCall>();
	const uploads = new Map<string, PendingCall>();
	const operations = new Map<string, PendingCall>();
	const pageRefreshListeners = new Set<() => void>();
	const interestOwners = new Set<{
		interest: EntityInterest;
		onUpdate: (update: EntityUpdate) => void;
	}>();
	let postedInterest = JSON.stringify({ foreground: [], visible: [] });
	const publishInterest = () => {
		const roots = new Set([...interestOwners].flatMap(({ interest }) => interest.foreground));
		const foreground = [...roots].sort().slice(0, MAX_INTEREST_ENTITY_IDS);
		const visible = [...new Set([...interestOwners].flatMap(({ interest }) => interest.visible))]
			.filter((id) => !roots.has(id))
			.sort()
			.slice(0, MAX_INTEREST_ENTITY_IDS - foreground.length);
		const serialized = JSON.stringify({ foreground, visible });
		if (serialized === postedInterest) {
			return;
		}
		if (!post({ type: "entity-interest", foreground, visible })) {
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
			...operations.values(),
			...queries.values(),
			...assets.values(),
			...uploads.values(),
		];
		operations.clear();
		queries.clear();
		assets.clear();
		uploads.clear();
		for (const pending of pendingCalls) {
			pending.cleanup?.();
			pending.reject(new RyotClientError(reason));
		}
	};

	const finish = (next: "failed" | "disposed", reason: RyotClientErrorReason, notify: boolean) => {
		if (state === "failed" || state === "disposed" || state === "closing") {
			return;
		}
		state = "closing";
		terminalReason = reason;
		rejectPending(reason);
		themeListeners.clear();
		pageRefreshListeners.clear();
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
			operations.size + queries.size + assets.size + uploads.size >=
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
			post({
				document,
				requestId,
				type: "ryotql-request",
			} satisfies PluginBridgeRyotQLRequest);
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
				fileName: request.fileName,
				type: "upload-request",
				contentType: request.contentType,
			} satisfies PluginBridgeUploadRequest);
		});

	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		const target = Match.value(to).pipe(
			Match.when({ kind: "plugin-route" }, ({ path, pluginSlug, search }) => ({
				path,
				kind: "plugin-route" as const,
				pluginSlug: PluginSlug.make(pluginSlug),
				search: search === undefined ? "" : new URLSearchParams(search).toString(),
			})),
			Match.when({ kind: "entity" }, ({ entityId }) => ({
				kind: "entity" as const,
				entityId: EntityId.make(entityId),
			})),
			Match.when({ kind: "saved-view" }, ({ savedViewId }) => ({
				kind: "saved-view" as const,
				savedViewId: SavedViewId.make(savedViewId),
			})),
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
		navigatePageSearch,
		openProviderSearch,
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
				update: (next) => {
					if (state !== "active") {
						throw new RyotClientError(terminalReason ?? "transport");
					}
					owner.interest = next;
					publishInterest();
				},
				dispose: () => {
					if (interestOwners.delete(owner)) {
						publishInterest();
					}
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
				Match.when({ type: "entity-updated" }, ({ entityId, reason }) => {
					for (const owner of Array.from(interestOwners)) {
						if (
							interestOwners.has(owner) &&
							(owner.interest.foreground.includes(entityId) ||
								owner.interest.visible.includes(entityId))
						) {
							owner.onUpdate({ entityId, reason });
						}
					}
				}),
				Match.when({ type: "location" }, ({ compact, edgeBack, index, key, leading, location }) => {
					let accepted: PluginNavigationSnapshot;
					try {
						accepted = navigationStore.setLocation({
							leading,
							compact,
							edgeBack,
							entry: { index, key, location },
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
					hasLocation = true;
					activate();
				}),
				Match.when({ type: "viewport" }, ({ safeAreaBottom, safeAreaTop }) =>
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
					for (const listener of pageRefreshListeners) {
						listener();
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
		page,
		fatal,
		client,
		navigation,
		forwardKernelShortcut,
		dispose: () => finish("disposed", "disposed", true),
		pageRefresh: {
			subscribe: (listener: () => void) => {
				pageRefreshListeners.add(listener);
				return () => pageRefreshListeners.delete(listener);
			},
		},
	};
};
