import {
	PluginBridgeHostMessage,
	type PluginBridgeInit,
	type PluginBridgeNavigate,
	type PluginBridgeOperationRequest,
	type PluginBridgeReady,
	type PluginBridgeRyotQLRequest,
	type PluginClientArtifactMetadata,
	type PluginOperationErrorReason,
} from "@ryot/contract/modules/plugins/client";
import type { JsonValue } from "@ryot/contract/schema/json";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Match, Result, Schema } from "effect";

import {
	createRyotClient,
	PluginOperationError,
	RyotQueryError,
	type RyotNavigationTarget,
} from "./index";
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
	let terminalOperationReason: PluginOperationErrorReason | undefined;
	const listeners = new AbortController();
	const locations = createPluginLocationStore();
	const operations = new Map<string, PendingCall>();
	const queries = new Map<string, PendingCall>();

	const rejectPending = (operationReason: PluginOperationErrorReason) => {
		const pendingOperations = [...operations.values()];
		const pendingQueries = [...queries.values()];
		operations.clear();
		queries.clear();
		for (const pending of pendingOperations) {
			pending.reject(new PluginOperationError(operationReason));
		}
		for (const pending of pendingQueries) {
			pending.reject(new RyotQueryError("transport"));
		}
	};

	const finish = (
		next: "failed" | "disposed",
		operationReason: PluginOperationErrorReason,
		notify: boolean,
	) => {
		if (state === "failed" || state === "disposed" || state === "closing") {
			return;
		}
		state = "closing";
		terminalOperationReason = operationReason;
		rejectPending(operationReason);
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
		} catch {
			finish("failed", "transport", false);
		}
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
			post({
				document,
				requestId,
				type: "ryotql-request",
			} satisfies PluginBridgeRyotQLRequest);
		});

	const invokeOperation = (request: { readonly slug: string; readonly input: JsonValue }) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new PluginOperationError(terminalOperationReason ?? "transport"));
				return;
			}
			nextRequestId += 1;
			const requestId = `operation-${nextRequestId}`;
			operations.set(requestId, { reject, resolve });
			post({
				requestId,
				input: request.input,
				type: "operation-request",
				operationSlug: request.slug,
			} satisfies PluginBridgeOperationRequest);
		});

	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		if (state !== "active") {
			return;
		}
		const search = to.search ? new URLSearchParams(to.search).toString() : "";
		post({
			mode,
			type: "navigate",
			location: { path: to.path, search },
		} satisfies PluginBridgeNavigate);
	};

	const client = createRyotClient({ query, invokeOperation, navigate });

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
				Match.when({ type: "location" }, ({ location }) => {
					state = "active";
					locations.set(location);
				}),
				Match.when({ type: "lifecycle-close" }, ({ reason }) =>
					finish(reason, reason === "disposed" ? "disposed" : "protocol", false),
				),
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
	port.addEventListener("messageerror", () => finish("failed", "transport", true), {
		signal: listeners.signal,
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
		client,
		locations,
		dispose: () => finish("disposed", "disposed", true),
	};
};
