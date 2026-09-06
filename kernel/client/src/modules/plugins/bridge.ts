import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeHostMessage,
	PluginBridgeLifecycleClose,
	PluginBridgeReady,
	isPageShortcut,
	type KernelShortcut,
	type PageShortcutKey,
	type ClientPageContext,
	type PluginAssetOutcome,
	type PluginAssetRequest,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeCollectionRequest,
	type PluginBridgeDismissOverlay,
	type PluginBridgeDismissOverlayResult,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeDocument,
	type PluginBridgeHeader,
	type PluginBridgeNavigate,
	type PluginBridgePageSearch,
	type PluginBridgePageRefresh,
	type PluginBridgePageShortcutPress,
	type PluginBridgeProviderSearchScreen,
	type PluginBridgeTheme,
	type PluginBridgeViewport,
	type PluginBridgeOperationRequest,
	type PluginBridgeOverlayState,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeScreenState,
	type PluginBridgeStorageRequest,
	type PluginBridgeUploadRequest,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginUploadOutcome,
	type PluginUploadRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
	type PluginThemeSnapshot,
	type PluginCollectionOutcome,
	type PluginCollectionRequest,
	type PluginStorageOutcome,
	type PluginStorageRequest,
} from "@ryot-app/client-plugin-contract";
import type { EntityInterestSubscription } from "@ryot-app/client-sdk";
import { Cause, Effect, Fiber, Match, Result, Schema } from "effect";

import type { WatchEntities } from "#/modules/entity-interest/service";

const HANDSHAKE_TIMEOUT_MS = 15_000;
const OVERLAY_DISMISS_TIMEOUT_MS = 1_000;

type PluginBridgeTarget = {
	readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
};

export type PluginScreenReadiness = Omit<PluginBridgeScreenState, "type">;
export type PluginBridgeViewportInsets = Omit<PluginBridgeViewport, "type">;
export type PluginBridgeNavigationState = Omit<PluginBridgeLocation, "type">;

export type PluginBridgeSession = {
	readonly close: () => void;
	readonly sendPageRefresh: () => void;
	readonly requestOverlayDismiss: () => boolean;
	readonly sendTheme: (theme: PluginThemeSnapshot) => void;
	readonly sendShortcut: (shortcut: PageShortcutKey) => void;
	readonly sendViewport: (insets: PluginBridgeViewportInsets) => void;
	readonly sendLocation: (navigation: PluginBridgeNavigationState) => void;
	readonly sendDocument: (
		documentKey: string,
		page: ClientPageContext,
		navigation: PluginBridgeNavigationState,
	) => void;
};

type PluginBridgeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingRequest = {
	readonly fiber: Fiber.Fiber<unknown, unknown>;
	readonly type: "asset" | "collection" | "operation" | "ryotql" | "storage" | "upload";
};

type PluginBridgeOptions = {
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly compositionHash: string;
	readonly onFailure: () => void;
	readonly page?: ClientPageContext;
	readonly documentKey: string;
	readonly onOpenDrawer: () => void;
	readonly theme: PluginThemeSnapshot;
	readonly target: PluginBridgeTarget;
	readonly onNavigateBack: () => void;
	readonly watchEntities: WatchEntities;
	readonly viewport: PluginBridgeViewportInsets;
	readonly navigation: PluginBridgeNavigationState;
	readonly onOverlayState: (count: number) => void;
	readonly onHeader: (request: PluginBridgeHeader) => void;
	readonly onNavigate: (request: PluginBridgeNavigate) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onScreenState: (state: PluginScreenReadiness) => void;
	readonly onPageSearch: (request: PluginBridgePageSearch) => void;
	readonly onPageShortcuts: (shortcuts: readonly PageShortcutKey[]) => void;
	readonly scheduleOverlayDismissTimeout?: (onTimeout: () => void) => () => void;
	readonly onProviderSearch: (request: PluginBridgeProviderSearchScreen) => void;
	readonly onAssets: (request: PluginAssetRequest) => Effect.Effect<PluginAssetOutcome>;
	readonly onRyotQL: (request: PluginRyotQLRequest) => Effect.Effect<PluginRyotQLOutcome>;
	readonly onOperation: (request: PluginOperationRequest) => Effect.Effect<PluginOperationOutcome>;
	readonly onCollection: (
		request: PluginCollectionRequest,
	) => Effect.Effect<PluginCollectionOutcome>;
	readonly onUpload: (request: PluginUploadRequest) => Effect.Effect<PluginUploadOutcome>;
	readonly onStorage: (request: PluginStorageRequest) => Effect.Effect<PluginStorageOutcome>;
	readonly onDiagnostic?: (diagnostic: {
		readonly type: PendingRequest["type"];
		readonly requestId: string;
		readonly cause: unknown;
	}) => void;
};

const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
const decodeHostMessage = Schema.decodeUnknownResult(PluginBridgeHostMessage);
const encodeHostMessage = Schema.encodeResult(PluginBridgeHostMessage);
const decodeClientMessage = Schema.decodeUnknownResult(PluginBridgeClientMessage);
const decodeLifecycleClose = Schema.decodeUnknownResult(PluginBridgeLifecycleClose);

const isExpectedReady = (ready: PluginBridgeReady, init: PluginBridgeInit) =>
	ready.sessionId === init.sessionId && ready.compositionHash === init.compositionHash;

export function openPluginBridge(options: PluginBridgeOptions): PluginBridgeSession {
	const init: PluginBridgeInit = {
		sessionId: crypto.randomUUID(),
		apiVersion: CLIENT_API_VERSION,
		format: CLIENT_ARTIFACT_FORMAT,
		mode: options.theme.resolvedMode,
		compositionHash: options.compositionHash,
		compilerVersion: CLIENT_COMPILER_VERSION,
		safeAreaTop: options.viewport.safeAreaTop,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		safeAreaBottom: options.viewport.safeAreaBottom,
		...(options.page === undefined ? {} : { page: options.page }),
		documentKey: options.documentKey,
	};

	let viewport = options.viewport;
	let navigation = options.navigation;
	let pendingDocument: { readonly key: string; readonly page: ClientPageContext } | undefined;
	let mode = options.theme.resolvedMode;
	let interestIds = new Set<string>();
	const channel = new MessageChannel();
	let state: PluginBridgeState = "ready";
	const listeners = new AbortController();
	const pending = new Map<string, PendingRequest>();
	let interest: EntityInterestSubscription | undefined;
	let overlayCount = 0;
	let nextOverlayRequestId = 0;
	let overlayDismiss:
		| { readonly requestId: string; readonly cancelTimeout: () => void }
		| undefined;
	const timer = window.setTimeout(() => fail(), options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);

	function finish(next: "failed" | "disposed", notify: boolean) {
		if (state === "closing" || state === "failed" || state === "disposed") {
			return;
		}
		state = "closing";
		try {
			interest?.dispose();
		} catch {
			/* Interest transport is best effort. */
		}
		interest = undefined;
		interestIds.clear();
		clearTimeout(timer);
		if (overlayDismiss !== undefined) {
			overlayDismiss.cancelTimeout();
			overlayDismiss = undefined;
		}
		overlayCount = 0;
		options.onOverlayState(0);
		if (notify) {
			try {
				channel.port1.postMessage({ reason: next, type: "lifecycle-close" });
			} catch {
				// The transport is already unavailable.
			}
		}
		listeners.abort();
		for (const { fiber } of pending.values()) {
			Effect.runFork(Fiber.interrupt(fiber));
		}
		pending.clear();
		channel.port1.close();
		state = next;
	}

	function close() {
		finish("disposed", true);
	}

	function fail(notify = true) {
		if (state === "closing" || state === "failed" || state === "disposed") {
			return;
		}
		finish("failed", notify);
		options.onFailure();
	}

	function post(message: unknown) {
		try {
			channel.port1.postMessage(message);
		} catch {
			fail();
		}
	}

	function sendTheme(next: PluginThemeSnapshot) {
		mode = next.resolvedMode;
		if (state !== "active") {
			return;
		}
		post({ mode, type: "theme" } satisfies PluginBridgeTheme);
	}

	function sendViewport(next: PluginBridgeViewportInsets) {
		if (
			viewport.safeAreaTop === next.safeAreaTop &&
			viewport.safeAreaBottom === next.safeAreaBottom
		) {
			return;
		}
		viewport = next;
		if (state !== "active") {
			return;
		}
		post({ ...viewport, type: "viewport" } satisfies PluginBridgeViewport);
	}

	function sendLocation(next: PluginBridgeNavigationState) {
		navigation = next;
		if (state !== "active") {
			return;
		}
		post({ ...navigation, type: "location" } satisfies PluginBridgeLocation);
	}

	function sendDocument(
		documentKey: string,
		page: ClientPageContext,
		next: PluginBridgeNavigationState,
	) {
		navigation = next;
		pendingDocument = { page, key: documentKey };
		if (state !== "active") {
			return;
		}
		interest?.dispose();
		interest = undefined;
		interestIds.clear();
		for (const { fiber } of pending.values()) {
			Effect.runFork(Fiber.interrupt(fiber));
		}
		pending.clear();
		overlayDismiss?.cancelTimeout();
		overlayDismiss = undefined;
		overlayCount = 0;
		options.onOverlayState(0);
		options.onPageShortcuts([]);
		post({
			page,
			documentKey,
			type: "document",
			navigation: { ...next, type: "location" },
		} satisfies PluginBridgeDocument);
		pendingDocument = undefined;
	}

	function sendPageRefresh() {
		if (state === "active") {
			post({ type: "page-refresh" } satisfies PluginBridgePageRefresh);
		}
	}

	function sendShortcut(shortcut: PageShortcutKey) {
		if (state === "active") {
			post({ shortcut, type: "page-shortcut-press" } satisfies PluginBridgePageShortcutPress);
		}
	}

	function requestOverlayDismiss() {
		if (overlayDismiss !== undefined) {
			return true;
		}
		if (state !== "active" || overlayCount === 0) {
			return false;
		}
		nextOverlayRequestId += 1;
		const requestId = `overlay-${nextOverlayRequestId}`;
		const cancelTimeout =
			options.scheduleOverlayDismissTimeout?.(() => fail()) ??
			(() => {
				const dismissTimer = window.setTimeout(() => fail(), OVERLAY_DISMISS_TIMEOUT_MS);
				return () => window.clearTimeout(dismissTimer);
			})();
		overlayDismiss = { requestId, cancelTimeout };
		post({ requestId, type: "dismiss-overlay" } satisfies PluginBridgeDismissOverlay);
		return true;
	}

	function handleOverlayState(request: PluginBridgeOverlayState) {
		overlayCount = request.count;
		options.onOverlayState(request.count);
	}

	function handleOverlayDismissResult(result: PluginBridgeDismissOverlayResult) {
		if (overlayDismiss?.requestId !== result.requestId) {
			return;
		}
		overlayDismiss.cancelTimeout();
		overlayDismiss = undefined;
		if (result.dismissed && overlayCount > 0) {
			overlayCount -= 1;
			options.onOverlayState(overlayCount);
		}
	}

	function handleLifecycleClose(reason: "disposed" | "failed") {
		if (reason === "failed") {
			fail(false);
		} else {
			finish("disposed", false);
			options.onFailure();
		}
	}

	function reportDiagnostic(type: PendingRequest["type"], requestId: string, cause: unknown) {
		if (options.onDiagnostic) {
			options.onDiagnostic({ type, cause, requestId });
		} else {
			console.error("Plugin bridge request failed", type, requestId, cause);
		}
	}

	function outgoingResult(type: PendingRequest["type"], requestId: string, outcome: object) {
		const failure = "outcome" in outcome && outcome.outcome === "failure";
		const message = failure
			? {
					requestId,
					outcome: "failure",
					type: `${type}-result`,
					reason: "reason" in outcome ? outcome.reason : undefined,
				}
			: { ...outcome, requestId, type: `${type}-result` };
		let decoded = decodeHostMessage(message);
		if (Result.isFailure(decoded)) {
			reportDiagnostic(type, requestId, decoded.failure);
			decoded = decodeHostMessage({
				requestId,
				outcome: "failure",
				type: `${type}-result`,
				reason:
					failure || type === "storage" || type === "ryotql" ? "transport" : "malformed-result",
			});
		}
		if (Result.isFailure(decoded)) {
			throw new Error("Invalid bridge failure outcome");
		}
		const encoded = encodeHostMessage(decoded.success);
		if (Result.isFailure(encoded)) {
			throw new Error("Invalid encoded bridge outcome");
		}
		return encoded.success;
	}

	function runRequest<Outcome extends object>(
		requestId: string,
		type: PendingRequest["type"],
		operation: () => Effect.Effect<Outcome>,
		failure: Outcome,
	) {
		if (pending.has(requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const fiber = Effect.runFork(
			Effect.yieldNow.pipe(
				Effect.flatMap(() => operation()),
				Effect.catchCause((cause) =>
					Cause.hasInterrupts(cause)
						? Effect.interrupt
						: Effect.sync(() => {
								reportDiagnostic(type, requestId, cause);
								return failure;
							}),
				),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (state !== "active" || pending.get(requestId)?.fiber !== fiber) {
							return;
						}
						try {
							let message;
							try {
								message = outgoingResult(type, requestId, outcome);
							} catch (cause) {
								reportDiagnostic(type, requestId, cause);
								message = outgoingResult(type, requestId, failure);
							}
							channel.port1.postMessage(message);
							pending.delete(requestId);
						} catch {
							fail();
						}
					}),
				),
			),
		);
		pending.set(requestId, { type, fiber });
	}

	function handleOperation(request: PluginBridgeOperationRequest) {
		runRequest(
			request.requestId,
			"operation",
			() =>
				options.onOperation({
					input: request.input,
					pluginSlug: request.pluginSlug,
					operationSlug: request.operationSlug,
				}),
			{ outcome: "failure", reason: "transport" } satisfies PluginOperationOutcome,
		);
	}

	function handleStorage(request: PluginBridgeStorageRequest) {
		const capabilityRequest: PluginStorageRequest =
			request.action === "set"
				? {
						key: request.key,
						value: request.value,
						action: request.action,
						pluginSlug: request.pluginSlug,
					}
				: { key: request.key, action: request.action, pluginSlug: request.pluginSlug };
		runRequest(request.requestId, "storage", () => options.onStorage(capabilityRequest), {
			outcome: "failure",
			reason: "transport",
		} satisfies PluginStorageOutcome);
	}

	function handleCollection(request: PluginBridgeCollectionRequest) {
		let capabilityRequest: PluginCollectionRequest;
		if (request.action === "create") {
			capabilityRequest = { action: "create", input: request.input };
		} else if (request.action === "upsert-membership") {
			capabilityRequest = { input: request.input, action: "upsert-membership" };
		} else {
			capabilityRequest = { input: request.input, action: "remove-membership" };
		}
		runRequest(request.requestId, "collection", () => options.onCollection(capabilityRequest), {
			outcome: "failure",
			reason: "transport",
		} satisfies PluginCollectionOutcome);
	}

	function handleUpload(request: PluginBridgeUploadRequest) {
		runRequest(
			request.requestId,
			"upload",
			() =>
				options.onUpload({
					source: request.source,
					fileName: request.fileName,
					contentType: request.contentType,
				}),
			{ outcome: "failure", reason: "transport" } satisfies PluginUploadOutcome,
		);
	}

	function handleAssets(request: PluginBridgeAssetRequest) {
		runRequest(request.requestId, "asset", () => options.onAssets({ assets: request.assets }), {
			outcome: "failure",
			reason: "transport",
		} satisfies PluginAssetOutcome);
	}

	function handleRyotQL(request: PluginBridgeRyotQLRequest) {
		runRequest(
			request.requestId,
			"ryotql",
			() => options.onRyotQL({ document: request.document }),
			{ outcome: "failure", reason: "transport" } satisfies PluginRyotQLOutcome,
		);
	}

	function handleRyotQLCancel(request: PluginBridgeRyotQLCancel) {
		const current = pending.get(request.requestId);
		if (current?.type !== "ryotql" || !pending.delete(request.requestId)) {
			return;
		}
		Effect.runFork(Fiber.interrupt(current.fiber));
	}

	function handleAssetCancel(request: PluginBridgeAssetCancel) {
		const current = pending.get(request.requestId);
		if (current?.type !== "asset" || !pending.delete(request.requestId)) {
			return;
		}
		Effect.runFork(Fiber.interrupt(current.fiber));
	}

	channel.port1.addEventListener(
		"message",
		(event) => {
			if (state === "active") {
				const decoded = decodeClientMessage(event.data);
				if (Result.isFailure(decoded)) {
					fail();
					return;
				}
				Match.value(decoded.success)
					.pipe(
						Match.when({ type: "entity-interest" }, ({ visible, foreground }) => {
							const declaration = { visible, foreground };
							interestIds = new Set([...declaration.foreground, ...declaration.visible]);
							try {
								if (interest) {
									interest.update(declaration);
								} else {
									interest = options.watchEntities(declaration, (update) => {
										if (state === "active" && interestIds.has(update.entityId)) {
											post({ ...update, type: "entity-updated" });
										}
									});
								}
							} catch {
								/* Interest transport must not fail the document. */
							}
						}),
						Match.when({ type: "asset-cancel" }, (request) => handleAssetCancel(request)),
						Match.when({ type: "asset-request" }, (request) => handleAssets(request)),
						Match.when({ type: "navigate-back" }, () => {
							if (!requestOverlayDismiss()) {
								options.onNavigateBack();
							}
						}),
						Match.when({ type: "overlay-state" }, (request) => handleOverlayState(request)),
						Match.when({ type: "dismiss-overlay-result" }, (result) =>
							handleOverlayDismissResult(result),
						),
						Match.when({ type: "open-drawer" }, () => options.onOpenDrawer()),
						Match.when({ type: "kernel-shortcut" }, ({ shortcut }) =>
							options.onKernelShortcut(shortcut),
						),
						Match.when({ type: "page-shortcuts" }, ({ shortcuts }) =>
							options.onPageShortcuts([...new Set(shortcuts.filter(isPageShortcut))].sort()),
						),
						Match.when({ type: "screen-state" }, ({ key, index, hasPreviousScreen }) => {
							if (index === navigation.index && key === navigation.key) {
								options.onScreenState({ key, index, hasPreviousScreen });
							}
						}),
					)
					.pipe(
						Match.when({ type: "header" }, (request) => options.onHeader(request)),
						Match.when({ type: "navigate" }, (request) => options.onNavigate(request)),
						Match.when({ type: "page-search" }, (request) => options.onPageSearch(request)),
						Match.when({ type: "provider-search-screen" }, (request) =>
							options.onProviderSearch(request),
						),
						Match.when({ type: "lifecycle-close" }, ({ reason }) => handleLifecycleClose(reason)),
						Match.when({ type: "ryotql-cancel" }, (request) => handleRyotQLCancel(request)),
						Match.when({ type: "ryotql-request" }, (request) => handleRyotQL(request)),
						Match.when({ type: "operation-request" }, (request) => handleOperation(request)),
						Match.when({ type: "collection-request" }, (request) => handleCollection(request)),
						Match.when({ type: "upload-request" }, (request) => handleUpload(request)),
						Match.when({ type: "storage-request" }, (request) => handleStorage(request)),
						Match.exhaustive,
					);
				return;
			}
			const lifecycleClose = decodeLifecycleClose(event.data);
			if (Result.isSuccess(lifecycleClose)) {
				handleLifecycleClose(lifecycleClose.success.reason);
				return;
			}
			const decoded = decodeReady(event.data);
			if (Result.isFailure(decoded) || !isExpectedReady(decoded.success, init)) {
				fail();
				return;
			}
			state = "active";
			clearTimeout(timer);
			if (pendingDocument) {
				const { key, page } = pendingDocument;
				pendingDocument = undefined;
				post({
					page,
					documentKey: key,
					type: "document",
					navigation: { ...navigation, type: "location" },
				} satisfies PluginBridgeDocument);
			} else {
				post({ ...navigation, type: "location" } satisfies PluginBridgeLocation);
			}
			if (mode !== init.mode) {
				post({ mode, type: "theme" } satisfies PluginBridgeTheme);
			}
			if (
				viewport.safeAreaTop !== init.safeAreaTop ||
				viewport.safeAreaBottom !== init.safeAreaBottom
			) {
				post({ ...viewport, type: "viewport" } satisfies PluginBridgeViewport);
			}
			options.onReady();
		},
		{ signal: listeners.signal },
	);
	channel.port1.addEventListener("messageerror", () => fail(), { signal: listeners.signal });
	channel.port1.start();
	try {
		options.target.postMessage(init, "*", [channel.port2]);
	} catch {
		channel.port2.close();
		fail(false);
	}

	return {
		close,
		sendTheme,
		sendShortcut,
		sendLocation,
		sendDocument,
		sendViewport,
		sendPageRefresh,
		requestOverlayDismiss,
	};
}
