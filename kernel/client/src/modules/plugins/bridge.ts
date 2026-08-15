import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeNavigate,
	PluginBridgeReady,
	type PluginBridgeInit,
	type PluginBridgeLocation,
	type PluginLogicalLocation,
} from "@ryot/contract/modules/plugins/client";
import { Result, Schema } from "effect";

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
};

const decodeReady = Schema.decodeUnknownResult(PluginBridgeReady);
const decodeNavigate = Schema.decodeUnknownResult(PluginBridgeNavigate);

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
	const timer = window.setTimeout(() => fail(), options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);

	function close() {
		if (closed) {
			return;
		}
		closed = true;
		clearTimeout(timer);
		listeners.abort();
		channel.port1.close();
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

	channel.port1.addEventListener(
		"message",
		(event) => {
			if (ready) {
				const navigate = decodeNavigate(event.data);
				if (Result.isSuccess(navigate)) {
					options.onNavigate(navigate.success);
				}
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
