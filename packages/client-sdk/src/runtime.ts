import {
	PluginBridgeHostMessage,
	REQUIRED_THEME_TOKEN_NAMES,
	type PluginBridgeInit,
	type PluginBridgeNavigate,
	type PluginBridgeOperationRequest,
	type PluginBridgeReady,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeThemeApplied,
	type PluginClientArtifactMetadata,
	type PluginThemeSnapshot,
	type RyotClientErrorReason,
} from "@ryot/contract/modules/plugins/client";
import type { JsonValue } from "@ryot/contract/schema/json";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Match, Result, Schema } from "effect";

import { createRyotClient, RyotClientError, type RyotNavigationTarget } from "./index";
import { createPluginLocationStore } from "./routing";

type PluginRuntimeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingCall = {
	readonly reject: (error: Error) => void;
	readonly resolve: (value: unknown) => void;
};

type PluginThemeStyle = {
	readonly setProperty: (property: string, value: string) => void;
};

const decodeHostMessage = Schema.decodeUnknownResult(PluginBridgeHostMessage);

export const createPluginRuntime = (
	port: MessagePort,
	init: PluginBridgeInit,
	metadata: PluginClientArtifactMetadata,
	style: PluginThemeStyle,
	onActive?: () => void,
	onTerminal?: () => void,
) => {
	let hasLocation = false;
	let theme: PluginThemeSnapshot | undefined;
	let nextRequestId = 0;
	let state: PluginRuntimeState = "ready";
	let terminalReason: RyotClientErrorReason | undefined;
	const listeners = new AbortController();
	const locations = createPluginLocationStore();
	const operations = new Map<string, PendingCall>();
	const queries = new Map<string, PendingCall>();
	const themeListeners = new Set<() => void>();

	const activate = () => {
		if (state === "ready" && hasLocation && theme) {
			state = "active";
			onActive?.();
		}
	};

	const rejectPending = (reason: RyotClientErrorReason) => {
		const pendingCalls = [...operations.values(), ...queries.values()];
		operations.clear();
		queries.clear();
		for (const pending of pendingCalls) {
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
				reject(new RyotClientError(terminalReason ?? "transport"));
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
				reject(new RyotClientError(terminalReason ?? "transport"));
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

	const client = createRyotClient({
		query,
		navigate,
		invokeOperation,
		theme: {
			getSnapshot: () => {
				if (!theme) {
					throw new RyotClientError(terminalReason ?? "transport");
				}
				return theme;
			},
			subscribe: (listener) => {
				themeListeners.add(listener);
				return () => themeListeners.delete(listener);
			},
		},
	});

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
					hasLocation = true;
					locations.set(location);
					activate();
				}),
				Match.when({ type: "theme" }, ({ generation, theme: nextTheme }) => {
					try {
						for (const token of REQUIRED_THEME_TOKEN_NAMES) {
							style.setProperty(`--${token}`, nextTheme.tokens[token]);
						}
					} catch {
						finish("failed", "protocol", true);
						return;
					}
					theme = nextTheme;
					for (const listener of themeListeners) {
						listener();
					}
					if (state === "ready") {
						post({ generation, type: "theme-applied" } satisfies PluginBridgeThemeApplied);
					}
					activate();
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
						pending.reject(new RyotClientError(result.reason));
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
