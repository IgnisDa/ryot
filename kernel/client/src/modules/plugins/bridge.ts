import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeLifecycleClose,
	PluginAssetBridgeErrorReason,
	PluginCollectionBridgeErrorReason,
	PluginOperationBridgeErrorReason,
	PluginBridgeReady,
	type KernelShortcut,
	type ClientPageContext,
	type PluginAssetOutcome,
	type PluginAssetRequest,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeAssetResult,
	type PluginBridgeCollectionRequest,
	type PluginBridgeDismissOverlay,
	type PluginBridgeDismissOverlayResult,
	PluginBridgeCollectionResult,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeHeader,
	type PluginBridgeNavigate,
	type PluginBridgePageSearch,
	type PluginBridgePageRefresh,
	type PluginBridgeProviderSearchScreen,
	type PluginBridgeTheme,
	type PluginBridgeViewport,
	type PluginBridgeOperationRequest,
	type PluginBridgeOperationResult,
	type PluginBridgeOverlayState,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeRyotQLResult,
	type PluginBridgeScreenState,
	type PluginBridgeUploadRequest,
	type PluginBridgeUploadResult,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginUploadOutcome,
	type PluginUploadRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
	type PluginThemeSnapshot,
	type PluginCollectionOutcome,
	type PluginCollectionRequest,
} from "@ryot-app/client-plugin-contract";
import type { EntityInterestSubscription } from "@ryot-app/client-sdk";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { Match, Result, Schema } from "effect";

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
	readonly sendViewport: (insets: PluginBridgeViewportInsets) => void;
	readonly sendLocation: (navigation: PluginBridgeNavigationState) => void;
};

type PluginBridgeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingRequest = {
	readonly controller: AbortController;
	readonly type: "asset" | "collection" | "operation" | "ryotql" | "upload";
};

type PluginBridgeOptions = {
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly artifactHash: string;
	readonly onFailure: () => void;
	readonly page?: ClientPageContext;
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
	readonly scheduleOverlayDismissTimeout?: (onTimeout: () => void) => () => void;
	readonly onProviderSearch: (request: PluginBridgeProviderSearchScreen) => void;
	readonly onAssets: (
		request: PluginAssetRequest,
		signal: AbortSignal,
	) => Promise<PluginAssetOutcome>;
	readonly onRyotQL: (
		request: PluginRyotQLRequest,
		signal: AbortSignal,
	) => Promise<PluginRyotQLOutcome>;
	readonly onOperation: (
		request: PluginOperationRequest,
		signal: AbortSignal,
	) => Promise<PluginOperationOutcome>;
	readonly onCollection: (
		request: PluginCollectionRequest,
		signal: AbortSignal,
	) => Promise<PluginCollectionOutcome>;
	readonly onUpload: (
		request: PluginUploadRequest,
		signal: AbortSignal,
	) => Promise<PluginUploadOutcome>;
};

const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
const isAssetBridgeErrorReason = Schema.is(PluginAssetBridgeErrorReason);
const isOperationBridgeErrorReason = Schema.is(PluginOperationBridgeErrorReason);
const isCollectionBridgeErrorReason = Schema.is(PluginCollectionBridgeErrorReason);
const decodeClientMessage = Schema.decodeUnknownResult(PluginBridgeClientMessage);
const decodeLifecycleClose = Schema.decodeUnknownResult(PluginBridgeLifecycleClose);

const isExpectedReady = (ready: PluginBridgeReady, init: PluginBridgeInit) =>
	ready.sessionId === init.sessionId && ready.artifactHash === init.artifactHash;

export function openPluginBridge(options: PluginBridgeOptions): PluginBridgeSession {
	const init: PluginBridgeInit = {
		sessionId: crypto.randomUUID(),
		apiVersion: CLIENT_API_VERSION,
		format: CLIENT_ARTIFACT_FORMAT,
		mode: options.theme.resolvedMode,
		artifactHash: options.artifactHash,
		compilerVersion: CLIENT_COMPILER_VERSION,
		safeAreaTop: options.viewport.safeAreaTop,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		safeAreaBottom: options.viewport.safeAreaBottom,
		...(options.page === undefined ? {} : { page: options.page }),
	};

	let viewport = options.viewport;
	let navigation = options.navigation;
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
		for (const { controller } of pending.values()) {
			controller.abort();
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

	function sendPageRefresh() {
		if (state === "active") {
			post({ type: "page-refresh" } satisfies PluginBridgePageRefresh);
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

	function handleOperation(request: PluginBridgeOperationRequest) {
		if (pending.has(request.requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const controller = new AbortController();
		pending.set(request.requestId, { controller, type: "operation" });
		void Promise.resolve()
			.then(() =>
				options.onOperation(
					{
						input: request.input,
						pluginSlug: request.pluginSlug,
						operationSlug: request.operationSlug,
					},
					controller.signal,
				),
			)
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginOperationOutcome)
			.then((outcome) => {
				if (state !== "active" || pending.get(request.requestId)?.controller !== controller) {
					return undefined;
				}
				let result: PluginOperationOutcome;
				if (outcome.outcome === "failure" && isOperationBridgeErrorReason(outcome.reason)) {
					result = { outcome: "failure", reason: outcome.reason };
				} else if (outcome.outcome === "failure") {
					result = { outcome: "failure", reason: "transport" };
				} else if (isJsonValue(outcome.value)) {
					result = { outcome: "success", value: outcome.value };
				} else {
					result = { outcome: "failure", reason: "malformed-result" };
				}
				try {
					channel.port1.postMessage({
						...result,
						type: "operation-result",
						requestId: request.requestId,
					} satisfies PluginBridgeOperationResult);
					if (pending.get(request.requestId)?.controller === controller) {
						pending.delete(request.requestId);
					}
				} catch {
					fail();
				}
				return undefined;
			});
	}

	function handleCollection(request: PluginBridgeCollectionRequest) {
		if (pending.has(request.requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const controller = new AbortController();
		pending.set(request.requestId, { controller, type: "collection" });
		let capabilityRequest: PluginCollectionRequest;
		if (request.action === "create") {
			capabilityRequest = { action: request.action, input: request.input };
		} else if (request.action === "upsert-membership") {
			capabilityRequest = { action: request.action, input: request.input };
		} else {
			capabilityRequest = { action: request.action, input: request.input };
		}
		void Promise.resolve()
			.then(() => options.onCollection(capabilityRequest, controller.signal))
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginCollectionOutcome)
			.then((outcome) => {
				if (state !== "active" || pending.get(request.requestId)?.controller !== controller) {
					return undefined;
				}
				let result: PluginCollectionOutcome;
				if (outcome.outcome === "failure" && isCollectionBridgeErrorReason(outcome.reason)) {
					result = { outcome: "failure", reason: outcome.reason };
				} else if (outcome.outcome === "failure") {
					result = { outcome: "failure", reason: "transport" };
				} else {
					const decoded = Schema.decodeUnknownResult(PluginBridgeCollectionResult)({
						...outcome,
						type: "collection-result",
						requestId: request.requestId,
					});
					result = Result.isSuccess(decoded)
						? outcome
						: { outcome: "failure", reason: "malformed-result" };
				}
				try {
					channel.port1.postMessage({
						...result,
						type: "collection-result",
						requestId: request.requestId,
					} satisfies PluginBridgeCollectionResult);
					if (pending.get(request.requestId)?.controller === controller) {
						pending.delete(request.requestId);
					}
				} catch {
					fail();
				}
				return undefined;
			});
	}

	function handleUpload(request: PluginBridgeUploadRequest) {
		if (pending.has(request.requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const controller = new AbortController();
		pending.set(request.requestId, { controller, type: "upload" });
		void Promise.resolve()
			.then(() =>
				options.onUpload(
					{ source: request.source, fileName: request.fileName, contentType: request.contentType },
					controller.signal,
				),
			)
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginUploadOutcome)
			.then((outcome) => {
				if (state !== "active" || pending.get(request.requestId)?.controller !== controller) {
					return undefined;
				}
				try {
					channel.port1.postMessage({
						...outcome,
						type: "upload-result",
						requestId: request.requestId,
					} satisfies PluginBridgeUploadResult);
					if (pending.get(request.requestId)?.controller === controller) {
						pending.delete(request.requestId);
					}
				} catch {
					fail();
				}
				return undefined;
			});
	}

	function handleAssets(request: PluginBridgeAssetRequest) {
		if (pending.has(request.requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const controller = new AbortController();
		pending.set(request.requestId, { controller, type: "asset" });
		void Promise.resolve()
			.then(() => options.onAssets({ assets: request.assets }, controller.signal))
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginAssetOutcome)
			.then((outcome) => {
				if (state !== "active" || pending.get(request.requestId)?.controller !== controller) {
					return undefined;
				}
				let result: PluginAssetOutcome;
				if (outcome.outcome === "failure" && isAssetBridgeErrorReason(outcome.reason)) {
					result = { outcome: "failure", reason: outcome.reason };
				} else if (outcome.outcome === "failure") {
					result = { outcome: "failure", reason: "transport" };
				} else {
					result = { outcome: "success", resolutions: outcome.resolutions };
				}
				try {
					channel.port1.postMessage({
						...result,
						type: "asset-result",
						requestId: request.requestId,
					} satisfies PluginBridgeAssetResult);
					if (pending.get(request.requestId)?.controller === controller) {
						pending.delete(request.requestId);
					}
				} catch {
					fail();
				}
				return undefined;
			});
	}

	function handleRyotQL(request: PluginBridgeRyotQLRequest) {
		if (pending.has(request.requestId)) {
			return;
		}
		if (pending.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			fail();
			return;
		}
		const controller = new AbortController();
		pending.set(request.requestId, { controller, type: "ryotql" });
		void Promise.resolve()
			.then(() => options.onRyotQL({ document: request.document }, controller.signal))
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginRyotQLOutcome)
			.then((outcome) => {
				if (state !== "active" || pending.get(request.requestId)?.controller !== controller) {
					return undefined;
				}
				try {
					channel.port1.postMessage({
						...outcome,
						type: "ryotql-result",
						requestId: request.requestId,
					} satisfies PluginBridgeRyotQLResult);
					if (pending.get(request.requestId)?.controller === controller) {
						pending.delete(request.requestId);
					}
				} catch {
					fail();
				}
				return undefined;
			});
	}

	function handleRyotQLCancel(request: PluginBridgeRyotQLCancel) {
		const current = pending.get(request.requestId);
		if (current?.type !== "ryotql" || !pending.delete(request.requestId)) {
			return;
		}
		current.controller.abort();
	}

	function handleAssetCancel(request: PluginBridgeAssetCancel) {
		const current = pending.get(request.requestId);
		if (current?.type !== "asset" || !pending.delete(request.requestId)) {
			return;
		}
		current.controller.abort();
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
				Match.value(decoded.success).pipe(
					Match.when({ type: "entity-interest" }, ({ foreground, visible }) => {
						const declaration = { foreground, visible };
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
					Match.when({ type: "screen-state" }, ({ hasPreviousScreen, index, key }) => {
						if (index === navigation.index && key === navigation.key) {
							options.onScreenState({ hasPreviousScreen, index, key });
						}
					}),
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
			post({ ...navigation, type: "location" } satisfies PluginBridgeLocation);
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
		sendLocation,
		sendViewport,
		sendPageRefresh,
		requestOverlayDismiss,
	};
}
