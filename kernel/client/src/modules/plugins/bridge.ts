import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeLifecycleClose,
	PluginBridgeReady,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeNavigate,
	type PluginBridgeOperationRequest,
	type PluginBridgeOperationResult,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeRyotQLResult,
	type PluginLogicalLocation,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
} from "@ryot/contract/modules/plugins/client";
import { isJsonValue } from "@ryot/contract/schema/json";
import { Match, Result, Schema } from "effect";

export const HANDSHAKE_TIMEOUT_MS = 15_000;

export type PluginBridgeTarget = {
	readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
};

export type PluginBridgeSession = {
	readonly close: () => void;
	readonly sendLocation: (location: PluginLogicalLocation) => void;
};

type PluginBridgeState = "ready" | "active" | "closing" | "failed" | "disposed";

export type PluginBridgeOptions = {
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly artifactHash: string;
	readonly onFailure: () => void;
	readonly target: PluginBridgeTarget;
	readonly location: PluginLogicalLocation;
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

	let state: PluginBridgeState = "ready";
	let location = options.location;
	const channel = new MessageChannel();
	const listeners = new AbortController();
	const pending = new Map<string, AbortController>();
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
		for (const controller of pending.values()) {
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

	function sendLocation(next: PluginLogicalLocation) {
		location = next;
		if (state !== "active") {
			return;
		}
		channel.port1.postMessage({ location, type: "location" } satisfies PluginBridgeLocation);
	}

	function handleOperation(request: PluginBridgeOperationRequest) {
		if (pending.has(request.requestId)) {
			return;
		}
		const controller = new AbortController();
		pending.set(request.requestId, controller);
		void Promise.resolve()
			.then(() =>
				options.onOperation(
					{ input: request.input, operationSlug: request.operationSlug },
					controller.signal,
				),
			)
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginOperationOutcome)
			.then((outcome) => {
				if (state !== "active" || !pending.has(request.requestId)) {
					return undefined;
				}
				const result =
					outcome.outcome === "success" && !isJsonValue(outcome.value)
						? ({ outcome: "failure", reason: "transport" } as const)
						: outcome;
				try {
					channel.port1.postMessage({
						...result,
						type: "operation-result",
						requestId: request.requestId,
					} satisfies PluginBridgeOperationResult);
					pending.delete(request.requestId);
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
		const controller = new AbortController();
		pending.set(request.requestId, controller);
		void Promise.resolve()
			.then(() => options.onRyotQL({ document: request.document }, controller.signal))
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginRyotQLOutcome)
			.then((outcome) => {
				if (state !== "active" || !pending.has(request.requestId)) {
					return undefined;
				}
				try {
					channel.port1.postMessage({
						...outcome,
						type: "ryotql-result",
						requestId: request.requestId,
					} satisfies PluginBridgeRyotQLResult);
					pending.delete(request.requestId);
				} catch {
					fail();
				}
				return undefined;
			});
	}

	channel.port1.addEventListener(
		"message",
		(event) => {
			if (state === "active") {
				const decoded = decodeClientMessage(event.data);
				if (Result.isFailure(decoded)) {
					return;
				}
				Match.value(decoded.success).pipe(
					Match.when({ type: "navigate" }, (request) => options.onNavigate(request)),
					Match.when({ type: "lifecycle-close" }, ({ reason }) => {
						if (reason === "failed") {
							fail(false);
						} else {
							finish("disposed", false);
							options.onFailure();
						}
					}),
					Match.when({ type: "ryotql-request" }, (request) => handleRyotQL(request)),
					Match.when({ type: "operation-request" }, (request) => handleOperation(request)),
					Match.exhaustive,
				);
				return;
			}
			const lifecycleClose = decodeLifecycleClose(event.data);
			if (Result.isSuccess(lifecycleClose)) {
				if (lifecycleClose.success.reason === "failed") {
					fail(false);
				} else {
					finish("disposed", false);
					options.onFailure();
				}
				return;
			}
			const decoded = decodeReady(event.data);
			if (Result.isFailure(decoded) || !isExpectedReady(decoded.success, init)) {
				fail();
				return;
			}
			state = "active";
			clearTimeout(timer);
			options.onReady();
			sendLocation(location);
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

	return { close, sendLocation };
}
