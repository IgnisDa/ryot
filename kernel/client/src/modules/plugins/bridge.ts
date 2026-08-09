import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeLifecycleClose,
	PluginOperationBridgeErrorReason,
	PluginBridgeReady,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeHeader,
	type PluginBridgeNavigate,
	type PluginBridgeTheme,
	type PluginBridgeOperationRequest,
	type PluginBridgeOperationResult,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeRyotQLResult,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
	type PluginThemeSnapshot,
} from "@ryot-app/contract/modules/plugins/client";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { Match, Result, Schema } from "effect";

const HANDSHAKE_TIMEOUT_MS = 15_000;

type PluginBridgeTarget = {
	readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
};

export type PluginBridgeNavigationState = Omit<PluginBridgeLocation, "type">;

export type PluginBridgeSession = {
	readonly close: () => void;
	readonly sendTheme: (theme: PluginThemeSnapshot) => void;
	readonly sendLocation: (navigation: PluginBridgeNavigationState) => void;
};

type PluginBridgeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingRequest = {
	readonly controller: AbortController;
	readonly type: "operation" | "ryotql";
};

type PluginBridgeOptions = {
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly artifactHash: string;
	readonly onFailure: () => void;
	readonly theme: PluginThemeSnapshot;
	readonly target: PluginBridgeTarget;
	readonly onNavigateBack: () => void;
	readonly navigation: PluginBridgeNavigationState;
	readonly onHeader: (request: PluginBridgeHeader) => void;
	readonly onNavigate: (request: PluginBridgeNavigate) => void;
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
const decodeLifecycleClose = Schema.decodeUnknownResult(PluginBridgeLifecycleClose);
const decodeClientMessage = Schema.decodeUnknownResult(PluginBridgeClientMessage);
const isOperationBridgeErrorReason = Schema.is(PluginOperationBridgeErrorReason);

const isExpectedReady = (ready: PluginBridgeReady, init: PluginBridgeInit) =>
	ready.sessionId === init.sessionId && ready.artifactHash === init.artifactHash;

export function openPluginBridge(options: PluginBridgeOptions): PluginBridgeSession {
	const init: PluginBridgeInit = {
		sessionId: crypto.randomUUID(),
		apiVersion: CLIENT_API_VERSION,
		format: CLIENT_ARTIFACT_FORMAT,
		artifactHash: options.artifactHash,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	};

	let bridgeReady = false;
	let theme = options.theme;
	let nextThemeGeneration = 0;
	let navigation = options.navigation;
	const channel = new MessageChannel();
	let state: PluginBridgeState = "ready";
	const listeners = new AbortController();
	let sentTheme: PluginThemeSnapshot | undefined;
	let awaitingThemeGeneration: number | undefined;
	const pending = new Map<string, PendingRequest>();
	const timer = window.setTimeout(() => fail(), options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);

	function finish(next: "failed" | "disposed", notify: boolean) {
		if (state === "closing" || state === "failed" || state === "disposed") {
			return;
		}
		state = "closing";
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

	function postTheme(nextTheme: PluginThemeSnapshot) {
		nextThemeGeneration += 1;
		const generation = nextThemeGeneration;
		post({ generation, theme: nextTheme, type: "theme" } satisfies PluginBridgeTheme);
		return generation;
	}

	function sendAwaitedTheme(nextTheme: PluginThemeSnapshot) {
		sentTheme = nextTheme;
		awaitingThemeGeneration = postTheme(nextTheme);
	}

	function sendTheme(next: PluginThemeSnapshot) {
		theme = next;
		if (state !== "active") {
			return;
		}
		postTheme(theme);
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
					Match.when({ type: "theme-applied" }, () => fail()),
					Match.when({ type: "navigate-back" }, () => options.onNavigateBack()),
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
			if (bridgeReady) {
				const decoded = decodeClientMessage(event.data);
				if (Result.isSuccess(decoded) && decoded.success.type === "lifecycle-close") {
					handleLifecycleClose(decoded.success.reason);
					return;
				}
				if (Result.isFailure(decoded) || decoded.success.type !== "theme-applied") {
					fail();
					return;
				}
				if (decoded.success.generation !== awaitingThemeGeneration) {
					fail();
					return;
				}
				if (sentTheme !== theme) {
					sendAwaitedTheme(theme);
					return;
				}
				awaitingThemeGeneration = undefined;
				state = "active";
				clearTimeout(timer);
				post({ ...navigation, type: "location" } satisfies PluginBridgeLocation);
				options.onReady();
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
			bridgeReady = true;
			sendAwaitedTheme(theme);
		},
		{ signal: listeners.signal },
	);
	channel.port1.start();
	try {
		options.target.postMessage(init, "*", [channel.port2]);
	} catch {
		channel.port2.close();
		fail(false);
	}

	return { close, sendTheme, sendLocation };
}
