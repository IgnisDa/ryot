import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeClientMessage,
	PluginBridgeReady,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginBridgeNavigate,
	type PluginBridgeOperationRequest,
	type PluginBridgeOperationResult,
	type PluginLogicalLocation,
	type PluginOperationOutcome,
	type PluginOperationRequest,
} from "@ryot/contract/modules/plugins/client";
import { Match, Result, Schema } from "effect";

export const HANDSHAKE_TIMEOUT_MS = 15_000;

export type PluginBridgeTarget = {
	readonly postMessage: (message: unknown, targetOrigin: string, transfer: Transferable[]) => void;
};

export type PluginBridgeSession = {
	readonly close: () => void;
	readonly sendLocation: (location: PluginLogicalLocation) => void;
};

export type PluginBridgeOptions = {
	readonly timeoutMs?: number;
	readonly onReady: () => void;
	readonly artifactHash: string;
	readonly onFailure: () => void;
	readonly target: PluginBridgeTarget;
	readonly location: PluginLogicalLocation;
	readonly onNavigate: (request: PluginBridgeNavigate) => void;
	readonly onOperation: (
		request: PluginOperationRequest,
		signal: AbortSignal,
	) => Promise<PluginOperationOutcome>;
};

const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
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

	let ready = false;
	let closed = false;
	let location = options.location;
	const channel = new MessageChannel();
	const listeners = new AbortController();
	const pending = new Map<string, AbortController>();
	const timer = window.setTimeout(() => fail(), options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);

	function close() {
		if (closed) {
			return;
		}
		closed = true;
		clearTimeout(timer);
		listeners.abort();
		channel.port1.close();
		for (const controller of pending.values()) {
			controller.abort();
		}
		pending.clear();
	}

	function fail() {
		close();
		options.onFailure();
	}

	function sendLocation(next: PluginLogicalLocation) {
		location = next;
		if (closed || !ready) {
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
		void options
			.onOperation(
				{ input: request.input, operationSlug: request.operationSlug },
				controller.signal,
			)
			.catch(() => ({ outcome: "failure", reason: "transport" }) satisfies PluginOperationOutcome)
			.then((outcome) => {
				if (closed || !pending.delete(request.requestId)) {
					return undefined;
				}
				channel.port1.postMessage({
					...outcome,
					type: "operation-result",
					requestId: request.requestId,
				} satisfies PluginBridgeOperationResult);
				return undefined;
			});
	}

	channel.port1.addEventListener(
		"message",
		(event) => {
			if (ready) {
				const decoded = decodeClientMessage(event.data);
				if (Result.isFailure(decoded)) {
					return;
				}
				Match.value(decoded.success).pipe(
					Match.when({ type: "navigate" }, (request) => options.onNavigate(request)),
					Match.when({ type: "operation-request" }, (request) => handleOperation(request)),
					Match.exhaustive,
				);
				return;
			}
			const decoded = decodeReady(event.data);
			if (Result.isFailure(decoded) || !isExpectedReady(decoded.success, init)) {
				fail();
				return;
			}
			ready = true;
			clearTimeout(timer);
			options.onReady();
			sendLocation(location);
		},
		{ signal: listeners.signal },
	);
	channel.port1.start();
	options.target.postMessage(init, "*", [channel.port2]);

	return { close, sendLocation };
}
