import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeLifecycleClose,
	PluginAssetBridgeErrorReason,
	PluginOperationBridgeErrorReason,
	PluginBridgeReady,
	type KernelShortcut,
	type PluginAssetOutcome,
	type PluginAssetRequest,
	type PluginBridgeAssetCancel,
	type PluginBridgeAssetRequest,
	type PluginBridgeAssetResult,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeHeader,
	type PluginBridgeNavigate,
	type PluginBridgeTheme,
	type PluginBridgeViewport,
	type PluginBridgeOperationRequest,
	type PluginBridgeOperationResult,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeRyotQLResult,
	type PluginBridgeScreenState,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
	type PluginThemeSnapshot,
} from "@ryot-app/client-plugin-contract";
import type { EntityInterestSubscription } from "@ryot-app/client-sdk";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { Match, Result, Schema } from "effect";

import type { WatchEntities } from "#/modules/entity-interest/service";

const HANDSHAKE_TIMEOUT_MS = 15_000;

type PluginBridgeTarget = {
	readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
};

export type PluginBridgeNavigationState = Omit<PluginBridgeLocation, "type">;
export type PluginBridgeViewportInsets = Omit<PluginBridgeViewport, "type">;
export type PluginScreenReadiness = Omit<PluginBridgeScreenState, "type">;

export type PluginBridgeSession = {
	readonly close: () => void;
	readonly sendViewport: (insets: PluginBridgeViewportInsets) => void;
	readonly sendTheme: (theme: PluginThemeSnapshot) => void;
	readonly sendLocation: (navigation: PluginBridgeNavigationState) => void;
};

type PluginBridgeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingRequest = {
	readonly controller: AbortController;
	readonly type: "asset" | "operation" | "ryotql";
};

type PluginBridgeOptions = {
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly artifactHash: string;
	readonly onFailure: () => void;
	readonly onOpenDrawer: () => void;
	readonly theme: PluginThemeSnapshot;
	readonly target: PluginBridgeTarget;
	readonly onNavigateBack: () => void;
	readonly watchEntities: WatchEntities;
	readonly viewport: PluginBridgeViewportInsets;
	readonly navigation: PluginBridgeNavigationState;
	readonly onHeader: (request: PluginBridgeHeader) => void;
	readonly onNavigate: (request: PluginBridgeNavigate) => void;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onScreenState: (state: PluginScreenReadiness) => void;
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
};

const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
const isAssetBridgeErrorReason = Schema.is(PluginAssetBridgeErrorReason);
const isOperationBridgeErrorReason = Schema.is(PluginOperationBridgeErrorReason);
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
					{ input: request.input, operationSlug: request.operationSlug },
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
					Match.when({ type: "navigate-back" }, () => options.onNavigateBack()),
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
					Match.when({ type: "lifecycle-close" }, ({ reason }) => handleLifecycleClose(reason)),
					Match.when({ type: "ryotql-cancel" }, (request) => handleRyotQLCancel(request)),
					Match.when({ type: "ryotql-request" }, (request) => handleRyotQL(request)),
					Match.when({ type: "operation-request" }, (request) => handleOperation(request)),
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

	return { close, sendTheme, sendLocation, sendViewport };
}
