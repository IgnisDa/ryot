import {
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	PluginBridgeHostMessage,
	REQUIRED_THEME_TOKEN_NAMES,
	type PluginBridgeHeader,
	type PluginBridgeInit,
	type PluginBridgeNavigate,
	type PluginBridgeNavigateBack,
	type PluginBridgeOperationRequest,
	type PluginBridgeReady,
	type PluginBridgeRyotQLCancel,
	type PluginBridgeRyotQLRequest,
	type PluginBridgeThemeApplied,
	type PluginClientArtifactMetadata,
	type PluginThemeSnapshot,
	type RyotClientErrorReason,
} from "@ryot-app/contract/modules/plugins/client";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Match, Result, Schema } from "effect";

import { createRyotClient, RyotClientError, type RyotNavigationTarget } from "./index";
import type { PluginNavigationController } from "./navigation/store";

type PluginRuntimeState = "ready" | "active" | "closing" | "failed" | "disposed";

type PendingCall = {
	readonly cleanup?: () => void;
	readonly reject: (error: unknown) => void;
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
	navigationStore: PluginNavigationController,
	onActive?: () => void,
	onTerminal?: () => void,
) => {
	let hasLocation = false;
	let theme: PluginThemeSnapshot | undefined;
	let nextRequestId = 0;
	let state: PluginRuntimeState = "ready";
	let terminalReason: RyotClientErrorReason | undefined;
	const listeners = new AbortController();
	const navigation = {
		subscribe: navigationStore.subscribe,
		getSnapshot: navigationStore.getSnapshot,
		back: () => post({ type: "navigate-back" } satisfies PluginBridgeNavigateBack),
		completeTransition: navigationStore.completeTransition,
	};
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
			pending.cleanup?.();
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
		hasLocation = false;
		navigationStore.clear();
		theme = undefined;
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
			return true;
		} catch {
			finish("failed", "transport", false);
			return false;
		}
	};

	const admit = (pending: Map<string, PendingCall>, requestId: string, call: PendingCall) => {
		if (operations.size + queries.size >= CLIENT_BRIDGE_MAX_PENDING_REQUESTS) {
			finish("failed", "protocol", true);
			call.reject(new RyotClientError("protocol"));
			return false;
		}
		pending.set(requestId, call);
		return true;
	};

	const query = (document: PreparedRecipe<unknown>["document"], signal?: AbortSignal) =>
		new Promise<unknown>((resolve, reject) => {
			if (state !== "active") {
				reject(new RyotClientError(terminalReason ?? "transport"));
				return;
			}
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			nextRequestId += 1;
			const requestId = `ryotql-${nextRequestId}`;
			const onAbort = () => {
				if (!queries.delete(requestId)) {
					return;
				}
				signal?.removeEventListener("abort", onAbort);
				reject(signal?.reason);
				post({ requestId, type: "ryotql-cancel" } satisfies PluginBridgeRyotQLCancel);
			};
			if (
				!admit(queries, requestId, {
					reject,
					resolve,
					cleanup: () => signal?.removeEventListener("abort", onAbort),
				})
			) {
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
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
			if (!admit(operations, requestId, { reject, resolve })) {
				return;
			}
			post({
				requestId,
				input: request.input,
				type: "operation-request",
				operationSlug: request.slug,
			} satisfies PluginBridgeOperationRequest);
		});

	const navigate = (mode: "push" | "replace", to: RyotNavigationTarget) => {
		if (state !== "active") {
			throw new RyotClientError(terminalReason ?? "transport");
		}
		const search = to.search ? new URLSearchParams(to.search).toString() : "";
		if (
			!post({
				mode,
				type: "navigate",
				location: { path: to.path, search },
			} satisfies PluginBridgeNavigate)
		) {
			throw new RyotClientError(terminalReason ?? "transport");
		}
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
				if (state === "closing" || state === "failed" || state === "disposed") {
					throw new RyotClientError(terminalReason ?? "transport");
				}
				themeListeners.add(listener);
				return () => themeListeners.delete(listener);
			},
		},
	});

	const fatal = () => finish("failed", "protocol", true);

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
				Match.when({ type: "location" }, ({ compact, edgeBack, index, key, location }) => {
					let next;
					try {
						next = navigationStore.setLocation({
							compact,
							edgeBack,
							entry: { index, key, location },
						});
					} catch {
						finish("failed", "protocol", true);
						return;
					}
					hasLocation = true;
					post({
						key,
						index,
						type: "header",
						header: next.screens.at(-1)?.header ?? null,
					} satisfies PluginBridgeHeader);
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
					pending.cleanup?.();
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
					pending.cleanup?.();
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

	return { fatal, client, navigation, dispose: () => finish("disposed", "disposed", true) };
};
