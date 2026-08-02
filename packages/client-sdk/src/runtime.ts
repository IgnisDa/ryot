import {
	PluginBridgeHostMessage,
	type PluginBridgeInit,
	type PluginBridgeNavigate,
	type PluginBridgeOperationRequest,
	type PluginBridgeReady,
	type PluginBridgeRyotQLRequest,
	type PluginClientArtifactMetadata,
} from "@ryot/contract/modules/plugins/client";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Match, Result, Schema } from "effect";

import { createRyotClient, PluginOperationError, RyotQueryError } from "./index";
import { createPluginLocationStore } from "./routing";

type PluginRuntimeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingCall = {
	readonly reject: (error: Error) => void;
	readonly resolve: (value: unknown) => void;
};

const decodeHostMessage = Schema.decodeUnknownResult(PluginBridgeHostMessage);

export const createPluginRuntime = (
	port: MessagePort,
	init: PluginBridgeInit,
	metadata: PluginClientArtifactMetadata,
	onTerminal?: () => void,
) => {
	let state: PluginRuntimeState = "ready";
	let nextRequestId = 0;
	const listeners = new AbortController();
	const locations = createPluginLocationStore();
	const operations = new Map<string, PendingCall>();
	const queries = new Map<string, PendingCall>();

	const rejectPending = () => {
		const pendingOperations = [...operations.values()];
		const pendingQueries = [...queries.values()];
		operations.clear();
		queries.clear();
		for (const pending of pendingOperations) {
			pending.reject(new PluginOperationError("transport"));
		}
		for (const pending of pendingQueries) {
			pending.reject(new RyotQueryError("transport"));
		}
	};

	const finish = (next: "failed" | "disposed", notify: boolean) => {
		if (state === "failed" || state === "disposed" || state === "closing") {
			return;
		}
		state = "closing";
		rejectPending();
		if (notify) {
			try {
				port.postMessage({ reason: next, type: "lifecycle-close" });
			} catch {
				// The transport is already unavailable.
			}
		}
		listeners.abort();
		port.close();
		state = next;
		onTerminal?.();
	};

	const query = (document: PreparedRecipe<unknown>["document"]) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotQueryError("transport"));
				return;
			}
			nextRequestId += 1;
			const requestId = `ryotql-${nextRequestId}`;
			queries.set(requestId, { reject, resolve });
			try {
				port.postMessage({
					document,
					requestId,
					type: "ryotql-request",
				} satisfies PluginBridgeRyotQLRequest);
			} catch {
				queries.delete(requestId);
				reject(new RyotQueryError("transport"));
			}
		});

	const invokeOperation = (request: { readonly slug: string; readonly input: unknown }) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new PluginOperationError("transport"));
				return;
			}
			nextRequestId += 1;
			const requestId = `operation-${nextRequestId}`;
			operations.set(requestId, { reject, resolve });
			try {
				port.postMessage({
					requestId,
					input: request.input,
					type: "operation-request",
					operationSlug: request.slug,
				} satisfies PluginBridgeOperationRequest);
			} catch {
				operations.delete(requestId);
				reject(new PluginOperationError("transport"));
			}
		});

	const client = createRyotClient({ query, invokeOperation });

	port.addEventListener(
		"message",
		(event) => {
			if (state === "failed" || state === "disposed" || state === "closing") {
				return;
			}
			const decoded = decodeHostMessage(event.data);
			if (Result.isFailure(decoded)) {
				return;
			}
			Match.value(decoded.success).pipe(
				Match.when({ type: "location" }, ({ location }) => {
					state = "active";
					locations.set(location);
				}),
				Match.when({ type: "lifecycle-close" }, ({ reason }) => finish(reason, false)),
				Match.when({ type: "operation-result" }, (result) => {
					const pending = operations.get(result.requestId);
					if (!pending || !operations.delete(result.requestId)) {
						return;
					}
					if (result.outcome === "failure") {
						pending.reject(new PluginOperationError(result.reason));
					} else {
						pending.resolve(result.value);
					}
				}),
				Match.when({ type: "ryotql-result" }, (result) => {
					const pending = queries.get(result.requestId);
					if (!pending || !queries.delete(result.requestId)) {
						return;
					}
					if (result.outcome === "failure") {
						pending.reject(new RyotQueryError(result.reason));
					} else {
						pending.resolve(result.response);
					}
				}),
				Match.exhaustive,
			);
		},
		{ signal: listeners.signal },
	);
	port.addEventListener("messageerror", () => finish("failed", true), { signal: listeners.signal });
	port.start();
	port.postMessage({
		format: metadata.format,
		sessionId: init.sessionId,
		artifactHash: metadata.hash,
		apiVersion: metadata.apiVersion,
		bridgeVersion: metadata.bridgeVersion,
		compilerVersion: metadata.compilerVersion,
	} satisfies PluginBridgeReady);

	return {
		client,
		locations,
		dispose: () => finish("disposed", true),
		navigate: (mode: "push" | "replace", to: { path: string; search?: Record<string, string> }) => {
			if (state !== "active") {
				return;
			}
			const search = to.search ? new URLSearchParams(to.search).toString() : "";
			port.postMessage({
				mode,
				type: "navigate",
				location: { path: to.path, search },
			} satisfies PluginBridgeNavigate);
		},
	};
};
