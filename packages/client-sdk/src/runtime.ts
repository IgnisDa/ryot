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
	type PluginBridgeReady,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeScreenState,
	type PluginClientArtifactMetadata,
	type PluginThemeSnapshot,
	type RyotClientErrorReason,
} from "@ryot-app/client-plugin-contract";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Match, Result, Schema } from "effect";

import { createRyotClient, RyotClientError, type RyotNavigationTarget } from "./index";
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
	const operations = new Map<string, PendingCall>();
	const queries = new Map<string, PendingCall>();
	const assets = new Map<string, PendingCall>();
	const themeListeners = new Set<() => void>();

	const activate = () => {
		if (state === "ready" && hasLocation) {
			state = "active";
			onActive?.();
		}
	};

	const rejectPending = (reason: RyotClientErrorReason) => {
		const pendingCalls = [...operations.values(), ...queries.values(), ...assets.values()];
		operations.clear();
		queries.clear();
		assets.clear();
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
		if (operations.size + queries.size + assets.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
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
				assets: [...requested],
				requestId,
				type: "asset-request",
			} satisfies PluginBridgeAssetRequest);
		});

	const invokeOperation = (request: { readonly slug: string; readonly input: JsonValue }) =>
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
			} satisfies PluginBridgeOperationRequest);
		});

	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		const target = Match.value(to).pipe(
			Match.when({ kind: "route" }, ({ path, search }) => ({
				path,
				kind: "route" as const,
				search: search === undefined ? "" : new URLSearchParams(search).toString(),
			})),
			Match.when({ kind: "entity" }, ({ entityId }) => ({
				kind: "entity" as const,
				entityId: EntityId.make(entityId),
			})),
			Match.exhaustive,
		);
		if (!post({ mode, target, type: "navigate" } satisfies PluginBridgeNavigate)) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
	};

	// TODO: `uploadTemporary` is intentionally omitted here until the plugin bridge can carry
	// binary payloads. Every bridge message is validated against a `JsonValue` payload schema,
	// so a `Blob` cannot cross the port and a plugin calling it gets `unsupported-capability`.
	const client = createRyotClient({
		query,
		navigate,
		resolveAssets,
		invokeOperation,
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
		forwardKernelShortcut,
		dispose: () => finish("disposed", "disposed", true),
	};
};
