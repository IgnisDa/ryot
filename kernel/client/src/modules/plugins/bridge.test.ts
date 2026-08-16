// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort takes a transfer list, not an origin
import {
	PluginBridgeInit,
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeNavigate,
	type PluginBridgeReady,
	type PluginLogicalLocation,
	type PluginRouteLocation,
	type PluginThemeSnapshot,
	type PluginOperationBridgeErrorReason,
	type PluginOperationOutcome,
	type PluginOperationRequest,
	type PluginRyotQLOutcome,
	type PluginRyotQLRequest,
} from "@ryot-app/contract/modules/plugins/client";
import { EntityId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { waitFor } from "@testing-library/dom";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
	openPluginBridge,
	type PluginBridgeSession,
	type PluginScreenReadiness,
} from "#/modules/plugins/bridge";

const decodeInit = Schema.decodeUnknownSync(PluginBridgeInit);

const artifactHash = "artifact-hash";
const home: PluginRouteLocation = { kind: "route", path: "/", search: "" };
const detail: PluginRouteLocation = { kind: "route", path: "/details/1", search: "" };
const entity: PluginLogicalLocation = {
	kind: "entity",
	entityId: EntityId.make("entity-1"),
	entitySchemaSlug: EntitySchemaSlug.make("show"),
};
const nav = (location: PluginLogicalLocation = home, index = 0) => ({
	index,
	location,
	leading: "none" as const,
	compact: false,
	edgeBack: false,
	key: `k${index}`,
});
const at = (location: PluginLogicalLocation = home, index = 0) => ({
	...nav(location, index),
	type: "location" as const,
});
const lightTheme: PluginThemeSnapshot = { resolvedMode: "light" };
const darkTheme: PluginThemeSnapshot = { resolvedMode: "dark" };
const document = {
	queries: {
		items: {
			from: { alias: "item", table: "item" },
			output: { fields: [], orderBy: [], pagination: { limit: 10 }, type: "rows" },
		},
	},
} as const;

const ports: MessagePort[] = [];
const sessions: PluginBridgeSession[] = [];

afterEach(() => {
	for (const session of sessions.splice(0)) {
		session.close();
	}
	for (const port of ports.splice(0)) {
		port.close();
	}
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const connect = (
	options: {
		readonly timeoutMs?: number;
		readonly onOperation?: (
			request: PluginOperationRequest,
			signal: AbortSignal,
		) => Promise<PluginOperationOutcome>;
		readonly onRyotQL?: (
			request: PluginRyotQLRequest,
			signal: AbortSignal,
		) => Promise<PluginRyotQLOutcome>;
	} = {},
) => {
	const backs: null[] = [];
	const drawers: null[] = [];
	const readies: null[] = [];
	const failures: null[] = [];
	const origins: string[] = [];
	const received: unknown[] = [];
	const messages: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let pluginPort: MessagePort | undefined;
	const navigations: PluginBridgeNavigate[] = [];
	const screenStates: PluginScreenReadiness[] = [];
	const operationCalls: Array<{
		readonly input: unknown;
		readonly signal: AbortSignal;
		readonly operationSlug: string;
	}> = [];

	const session = openPluginBridge({
		artifactHash,
		safeAreaTop: 0,
		navigation: nav(),
		theme: lightTheme,
		onHeader: () => {},
		timeoutMs: options.timeoutMs,
		onReady: () => readies.push(null),
		onFailure: () => failures.push(null),
		onNavigateBack: () => backs.push(null),
		onOpenDrawer: () => drawers.push(null),
		onScreenState: (state) => screenStates.push(state),
		onNavigate: (request) => navigations.push(request),
		onRyotQL: options.onRyotQL ?? (() => new Promise(() => {})),
		onOperation:
			options.onOperation ??
			((request, signal) => {
				operationCalls.push({ signal, input: request.input, operationSlug: request.operationSlug });
				return new Promise(() => {});
			}),
		target: {
			postMessage: (message, targetOrigin, transfer) => {
				const [transferred] = transfer;
				if (!(transferred instanceof MessagePort)) {
					throw new Error("The bridge did not transfer a MessagePort.");
				}
				origins.push(targetOrigin);
				init = decodeInit(message);
				transferred.addEventListener("message", (event) => {
					messages.push(event.data);
					received.push(event.data);
				});
				transferred.start();
				ports.push(transferred);
				pluginPort = transferred;
			},
		},
	});
	sessions.push(session);

	if (init === undefined || pluginPort === undefined) {
		throw new Error("The bridge never transferred a port to the plugin document.");
	}
	return {
		init,
		backs,
		session,
		origins,
		readies,
		drawers,
		failures,
		messages,
		received,
		pluginPort,
		navigations,
		screenStates,
		operationCalls,
	};
};

const readyFor = (init: PluginBridgeInit): PluginBridgeReady => ({
	artifactHash,
	sessionId: init.sessionId,
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
});

describe("plugin bridge", () => {
	it("transfers exactly one port with the exact init markers and the resolved mode", () => {
		const { init, origins } = connect();

		expect(origins).toEqual(["*"]);
		expect(init).toEqual({
			artifactHash,
			mode: "light",
			safeAreaTop: 0,
			sessionId: init.sessionId,
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		});
		expect(init.sessionId).not.toBe("");
	});

	it("cleans up immediately when the initial port transfer fails", async () => {
		const failures: null[] = [];
		const session = openPluginBridge({
			artifactHash,
			timeoutMs: 10,
			safeAreaTop: 0,
			navigation: nav(),
			theme: lightTheme,
			onHeader: () => {},
			onReady: () => undefined,
			onNavigate: () => undefined,
			onOpenDrawer: () => undefined,
			onScreenState: () => undefined,
			onNavigateBack: () => undefined,
			onFailure: () => failures.push(null),
			onRyotQL: () => new Promise(() => {}),
			onOperation: () => new Promise(() => {}),
			target: {
				postMessage: () => {
					throw new Error("transfer failed");
				},
			},
		});
		sessions.push(session);

		expect(failures).toHaveLength(1);
		await delay(40);
		expect(failures).toHaveLength(1);
	});

	it("readies with the location as soon as the plugin reports ready", async () => {
		const { init, pluginPort, readies, failures, messages } = connect();

		pluginPort.postMessage(readyFor(init));

		await waitFor(() => expect(readies).toHaveLength(1));
		expect(messages).toEqual([at()]);
		expect(failures).toEqual([]);
	});

	it("forwards matching active screen readiness without protocol policy", async () => {
		const { init, pluginPort, readies, screenStates } = connect();

		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(readies).toHaveLength(1));
		pluginPort.postMessage({ index: 0, key: "k0", type: "screen-state", hasPreviousScreen: true });

		await waitFor(() =>
			expect(screenStates).toEqual([{ index: 0, key: "k0", hasPreviousScreen: true }]),
		);
	});

	it("ignores screen readiness that no longer matches the latest navigation", async () => {
		const { init, pluginPort, readies, screenStates, session } = connect();

		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(readies).toHaveLength(1));
		session.sendLocation(nav(detail, 1));
		pluginPort.postMessage({ index: 0, key: "k0", type: "screen-state", hasPreviousScreen: true });
		pluginPort.postMessage({ index: 1, key: "k1", type: "screen-state", hasPreviousScreen: false });

		await waitFor(() =>
			expect(screenStates).toEqual([{ index: 1, key: "k1", hasPreviousScreen: false }]),
		);
	});

	it("does not process screen readiness before activation or after close", async () => {
		const premature = connect();
		premature.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "screen-state",
			hasPreviousScreen: false,
		});
		await waitFor(() => expect(premature.failures).toHaveLength(1));

		const closed = connect();
		closed.pluginPort.postMessage(readyFor(closed.init));
		await waitFor(() => expect(closed.readies).toHaveLength(1));
		closed.session.close();
		closed.pluginPort.postMessage({
			index: 0,
			key: "k0",
			type: "screen-state",
			hasPreviousScreen: true,
		});
		await delay(10);

		expect(premature.screenStates).toEqual([]);
		expect(closed.screenStates).toEqual([]);
	});

	it("fails a ready from another session or another artifact", async () => {
		const other = connect();
		other.pluginPort.postMessage({ ...readyFor(other.init), sessionId: "other-session" });
		await waitFor(() => expect(other.failures).toHaveLength(1));

		const mismatched = connect();
		mismatched.pluginPort.postMessage({
			...readyFor(mismatched.init),
			artifactHash: "other-artifact",
		});
		await waitFor(() => expect(mismatched.failures).toHaveLength(1));

		expect(other.readies).toEqual([]);
		expect(mismatched.readies).toEqual([]);
	});

	it("fails a malformed, wrong-version, or out-of-order first message", async () => {
		const malformed = connect();
		malformed.pluginPort.postMessage({ sessionId: malformed.init.sessionId });
		await waitFor(() => expect(malformed.failures).toHaveLength(1));

		const outdated = connect();
		outdated.pluginPort.postMessage({ ...readyFor(outdated.init), bridgeVersion: 0 });
		await waitFor(() => expect(outdated.failures).toHaveLength(1));

		const premature = connect();
		premature.pluginPort.postMessage({ type: "navigate", mode: "push", location: home });
		await waitFor(() => expect(premature.failures).toHaveLength(1));

		expect(premature.navigations).toEqual([]);
	});

	it("honors lifecycle closure before activation without replying with a failure", async () => {
		const disposed = connect();
		disposed.pluginPort.postMessage({ reason: "disposed", type: "lifecycle-close" });
		await waitFor(() => expect(disposed.failures).toHaveLength(1));

		const failed = connect();
		failed.pluginPort.postMessage({ reason: "failed", type: "lifecycle-close" });
		await waitFor(() => expect(failed.failures).toHaveLength(1));

		expect(disposed.received).toEqual([]);
		expect(failed.received).toEqual([]);
	});

	it("fails when the plugin never completes the handshake", async () => {
		const { failures, readies } = connect({ timeoutMs: 10 });

		await waitFor(() => expect(failures).toHaveLength(1));
		expect(readies).toEqual([]);
	});

	it("stops the handshake timeout once the plugin is ready", async () => {
		const { init, pluginPort, failures, readies } = connect({ timeoutMs: 10 });

		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(readies).toHaveLength(1));
		await delay(40);

		expect(failures).toEqual([]);
	});

	it("delivers only the latest pre-ready location, then every later location", async () => {
		const { init, pluginPort, received, session } = connect();

		session.sendLocation(nav(detail, 1));
		session.sendLocation(nav({ kind: "route", path: "/details/2", search: "tab=stats" }, 2));
		pluginPort.postMessage(readyFor(init));

		await waitFor(() =>
			expect(received).toEqual([at({ kind: "route", path: "/details/2", search: "tab=stats" }, 2)]),
		);

		session.sendLocation(nav());

		await waitFor(() =>
			expect(received).toEqual([
				at({ kind: "route", path: "/details/2", search: "tab=stats" }, 2),
				at(),
			]),
		);
	});

	it("sends an entity location from the kernel to the plugin", async () => {
		const { init, pluginPort, received, session } = connect();

		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toEqual([at()]));

		session.sendLocation(nav(entity, 1));

		await waitFor(() => expect(received).toEqual([at(), at(entity, 1)]));
	});

	it("latches a pre-ready theme change and sends later themes on the active channel", async () => {
		const { init, messages, pluginPort, readies, session } = connect();

		session.sendTheme(darkTheme);
		pluginPort.postMessage(readyFor(init));

		await waitFor(() => expect(readies).toHaveLength(1));
		expect(messages).toEqual([at(), { mode: "dark", type: "theme" }]);

		session.sendTheme(lightTheme);
		await waitFor(() =>
			expect(messages).toEqual([
				at(),
				{ mode: "dark", type: "theme" },
				{ mode: "light", type: "theme" },
			]),
		);
	});

	it("sends no theme when the pre-ready mode still matches init", async () => {
		const { init, messages, pluginPort, readies, session } = connect();

		session.sendTheme(darkTheme);
		session.sendTheme(lightTheme);
		pluginPort.postMessage(readyFor(init));

		await waitFor(() => expect(readies).toHaveLength(1));
		expect(messages).toEqual([at()]);
	});

	it("forwards decoded navigation requests once ready", async () => {
		const { init, pluginPort, readies, navigations, failures } = connect();
		const request = {
			mode: "push",
			type: "navigate",
			location: { kind: "route", path: "/details/1", search: "tab=stats" },
		} satisfies PluginBridgeNavigate;

		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(readies).toHaveLength(1));
		pluginPort.postMessage(request);

		await waitFor(() => expect(navigations).toEqual([request]));
		expect(failures).toEqual([]);
	});

	it("sends only lifecycle close after teardown or a failed handshake", async () => {
		const torndown = connect();
		torndown.session.close();
		torndown.session.sendLocation(nav(detail, 1));

		const failed = connect({ timeoutMs: 10 });
		await waitFor(() => expect(failed.failures).toHaveLength(1));
		failed.session.sendLocation(nav(detail, 1));

		await delay(10);

		expect(torndown.received).toEqual([{ reason: "disposed", type: "lifecycle-close" }]);
		expect(failed.received).toEqual([{ reason: "failed", type: "lifecycle-close" }]);
	});

	it("stops delivering after teardown", async () => {
		const { init, pluginPort, readies, failures, session } = connect();

		session.close();
		pluginPort.postMessage(readyFor(init));
		await delay(10);

		expect(readies).toEqual([]);
		expect(failures).toEqual([]);
	});

	it("honors peer disposal, aborts work, and ignores late admissions", async () => {
		let signal: AbortSignal | undefined;
		const call = deferred<PluginOperationOutcome>();
		const { init, pluginPort, received, navigations } = connect({
			onOperation: (_request, requestSignal) => {
				signal = requestSignal;
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));
		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(signal).toBeDefined());

		pluginPort.postMessage({ reason: "disposed", type: "lifecycle-close" });
		await waitFor(() => expect(signal?.aborted).toBe(true));
		pluginPort.postMessage({ type: "navigate", mode: "push", location: home });
		call.resolve({ outcome: "success", value: "late" });
		await delay(10);

		expect(navigations).toEqual([]);
		expect(received).toEqual([at()]);
	});

	it("round-trips a successful operation", async () => {
		const calls: PluginOperationRequest[] = [];
		const { init, pluginPort, received } = connect({
			onOperation: (request) => {
				calls.push(request);
				return Promise.resolve({ outcome: "success", value: "ok" });
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
			input: { greeting: "hi" },
		});

		await waitFor(() =>
			expect(received).toContainEqual({
				value: "ok",
				outcome: "success",
				requestId: "request-1",
				type: "operation-result",
			}),
		);
		expect(calls).toEqual([{ input: { greeting: "hi" }, operationSlug: "greet" }]);
	});

	it("maps synchronous operation and query failures to transport results", async () => {
		const { init, pluginPort, received } = connect({
			onOperation: () => {
				throw new Error("operation failed synchronously");
			},
			onRyotQL: () => {
				throw new Error("query failed synchronously");
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			operationSlug: "greet",
			requestId: "operation-1",
			type: "operation-request",
		});
		pluginPort.postMessage({ document, requestId: "query-1", type: "ryotql-request" });

		await waitFor(() => expect(received).toHaveLength(3));
		expect(received).toContainEqual({
			outcome: "failure",
			reason: "transport",
			requestId: "operation-1",
			type: "operation-result",
		});
		expect(received).toContainEqual({
			outcome: "failure",
			reason: "transport",
			requestId: "query-1",
			type: "ryotql-result",
		});
	});

	it("maps an invalid operation success to malformed-result and keeps the session alive", async () => {
		let calls = 0;
		const { init, pluginPort, received, failures } = connect({
			onOperation: () => {
				calls += 1;
				return Promise.resolve(
					calls === 1
						? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- injects an invalid runtime boundary value
							({ outcome: "success", value: () => undefined } as unknown as PluginOperationOutcome)
						: { outcome: "success", value: "ok" },
				);
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});

		await waitFor(() =>
			expect(received).toContainEqual({
				outcome: "failure",
				requestId: "request-1",
				type: "operation-result",
				reason: "malformed-result",
			}),
		);
		pluginPort.postMessage({
			input: null,
			requestId: "request-2",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() =>
			expect(received).toContainEqual({
				value: "ok",
				outcome: "success",
				requestId: "request-2",
				type: "operation-result",
			}),
		);
		expect(failures).toEqual([]);
	});

	for (const reason of [
		"transport",
		"operation-failed",
		"malformed-result",
	] satisfies PluginOperationBridgeErrorReason[]) {
		it(`round-trips a ${reason} operation bridge error without extra details`, async () => {
			const { init, pluginPort, received, failures } = connect({
				onOperation: () =>
					Promise.resolve(
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- verifies runtime detail redaction
						{ outcome: "failure", reason, cause: new Error("private") } as PluginOperationOutcome,
					),
			});
			pluginPort.postMessage(readyFor(init));
			await waitFor(() => expect(received).toHaveLength(1));

			pluginPort.postMessage({
				input: null,
				requestId: "request-1",
				operationSlug: "greet",
				type: "operation-request",
			});

			await waitFor(() => expect(received).toHaveLength(2));
			expect(received[1]).toEqual({
				reason,
				outcome: "failure",
				requestId: "request-1",
				type: "operation-result",
			});
			expect(failures).toEqual([]);
		});
	}

	it("maps an invalid callback failure reason to transport", async () => {
		const { init, pluginPort, received } = connect({
			onOperation: () =>
				Promise.resolve(
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- injects an invalid runtime boundary value
					{ outcome: "failure", reason: "private-failure" } as unknown as PluginOperationOutcome,
				),
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});

		await waitFor(() => expect(received).toHaveLength(2));
		expect(received[1]).toEqual({
			outcome: "failure",
			reason: "transport",
			requestId: "request-1",
			type: "operation-result",
		});
	});

	it("reports a transport failure when onOperation rejects", async () => {
		const { init, pluginPort, received } = connect({
			onOperation: () => Promise.reject(new Error("boom")),
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});

		await waitFor(() =>
			expect(received).toContainEqual({
				outcome: "failure",
				reason: "transport",
				requestId: "request-1",
				type: "operation-result",
			}),
		);
		expect(received).toHaveLength(2);
	});

	it("settles two concurrent calls out of order, each exactly once", async () => {
		const calls: Array<ReturnType<typeof deferred<PluginOperationOutcome>>> = [];
		const { init, pluginPort, received } = connect({
			onOperation: () => {
				const call = deferred<PluginOperationOutcome>();
				calls.push(call);
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: "a",
			requestId: "request-a",
			operationSlug: "greet",
			type: "operation-request",
		});
		pluginPort.postMessage({
			input: "b",
			requestId: "request-b",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(calls).toHaveLength(2));

		calls[1]?.resolve({ outcome: "success", value: "b-value" });
		await waitFor(() =>
			expect(received).toContainEqual({
				value: "b-value",
				outcome: "success",
				requestId: "request-b",
				type: "operation-result",
			}),
		);

		calls[0]?.resolve({ outcome: "success", value: "a-value" });
		await waitFor(() =>
			expect(received).toContainEqual({
				value: "a-value",
				outcome: "success",
				requestId: "request-a",
				type: "operation-result",
			}),
		);

		expect(received).toHaveLength(3);
	});

	it("ignores a second request that reuses an in-flight request id", async () => {
		const calls: Array<ReturnType<typeof deferred<PluginOperationOutcome>>> = [];
		const { init, pluginPort, received } = connect({
			onOperation: () => {
				const call = deferred<PluginOperationOutcome>();
				calls.push(call);
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: "a",
			requestId: "request-a",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(calls).toHaveLength(1));

		pluginPort.postMessage({
			input: "a-again",
			requestId: "request-a",
			operationSlug: "greet",
			type: "operation-request",
		});
		await delay(10);

		expect(calls).toHaveLength(1);
		calls[0]?.resolve({ outcome: "success", value: "a-value" });

		await waitFor(() =>
			expect(received).toContainEqual({
				value: "a-value",
				outcome: "success",
				requestId: "request-a",
				type: "operation-result",
			}),
		);
		expect(received).toHaveLength(2);
	});

	it("fails the session when aggregate pending requests exceed the admission limit", async () => {
		const signals: AbortSignal[] = [];
		const { init, pluginPort, received, failures } = connect({
			onOperation: (_request, signal) => {
				signals.push(signal);
				return new Promise(() => {});
			},
			onRyotQL: (_request, signal) => {
				signals.push(signal);
				return new Promise(() => {});
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		for (let index = 0; index < CLIENT_BRIDGE_MAX_PENDING_REQUESTS; index += 1) {
			if (index % 2 === 0) {
				pluginPort.postMessage({
					input: null,
					operationSlug: "greet",
					type: "operation-request",
					requestId: `request-${index}`,
				});
			} else {
				pluginPort.postMessage({ document, type: "ryotql-request", requestId: `request-${index}` });
			}
		}
		await waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS));

		pluginPort.postMessage({ document, requestId: "overflow", type: "ryotql-request" });
		await waitFor(() => expect(failures).toHaveLength(1));

		expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
	});

	it("fails the session on a malformed active-port message and suppresses late work", async () => {
		let signal: AbortSignal | undefined;
		const call = deferred<PluginOperationOutcome>();
		const { init, pluginPort, received, failures } = connect({
			onOperation: (_request, requestSignal) => {
				signal = requestSignal;
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(signal).toBeDefined());

		pluginPort.postMessage({
			requestId: "malformed",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(failures).toHaveLength(1));
		expect(signal?.aborted).toBe(true);

		call.resolve({ outcome: "success", value: "late" });
		await delay(10);

		expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
	});

	it.each([
		["untagged", { path: "/details/1", search: "" }],
		["entity-shaped", { entityId: "entity-1", entitySchemaSlug: "show", kind: "entity" }],
	] as const)("fails an %s plugin navigation message", async (_label, location) => {
		const { init, pluginPort, received, failures, navigations } = connect();
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toEqual([at()]));

		pluginPort.postMessage({ location, mode: "push", type: "navigate" });

		await waitFor(() => expect(failures).toHaveLength(1));
		expect(navigations).toEqual([]);
		expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
	});

	it("aborts pending operation and RyotQL work on failure and suppresses both late results", async () => {
		let operationSignal: AbortSignal | undefined;
		let querySignal: AbortSignal | undefined;
		const operationCall = deferred<PluginOperationOutcome>();
		const queryCall = deferred<PluginRyotQLOutcome>();
		const { init, pluginPort, received, failures } = connect({
			onOperation: (_request, signal) => {
				operationSignal = signal;
				return operationCall.promise;
			},
			onRyotQL: (_request, signal) => {
				querySignal = signal;
				return queryCall.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			operationSlug: "greet",
			requestId: "operation-1",
			type: "operation-request",
		});
		pluginPort.postMessage({ document, requestId: "query-1", type: "ryotql-request" });
		await waitFor(() => {
			expect(querySignal).toBeDefined();
			expect(operationSignal).toBeDefined();
		});

		pluginPort.postMessage({ type: "unknown-message" });
		await waitFor(() => expect(failures).toHaveLength(1));
		expect(operationSignal?.aborted).toBe(true);
		expect(querySignal?.aborted).toBe(true);

		operationCall.resolve({ outcome: "success", value: "late-operation" });
		queryCall.resolve({ outcome: "success", response: { data: {} } });
		await delay(10);

		expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
	});

	it("fails the session before invoking an operation with extra identity fields", async () => {
		const { init, pluginPort, received, failures, operationCalls } = connect();
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
			installationId: "installation-2",
		});
		await waitFor(() => expect(failures).toHaveLength(1));

		expect(operationCalls).toEqual([]);
		expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
	});

	it("aborts pending signals on close and posts nothing after a late resolution", async () => {
		let signal: AbortSignal | undefined;
		const call = deferred<PluginOperationOutcome>();
		const { init, pluginPort, received, session } = connect({
			onOperation: (_request, requestSignal) => {
				signal = requestSignal;
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(signal).toBeDefined());

		session.close();
		expect(signal?.aborted).toBe(true);

		call.resolve({ outcome: "success", value: "too-late" });
		await delay(10);

		expect(received).toEqual([at(), { reason: "disposed", type: "lifecycle-close" }]);
	});

	it("correlates concurrent RyotQL requests completed out of order", async () => {
		const calls: Array<ReturnType<typeof deferred<PluginRyotQLOutcome>>> = [];
		const { init, pluginPort, received } = connect({
			onRyotQL: () => {
				const call = deferred<PluginRyotQLOutcome>();
				calls.push(call);
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({ document, requestId: "query-a", type: "ryotql-request" });
		pluginPort.postMessage({ document, requestId: "query-b", type: "ryotql-request" });
		await waitFor(() => expect(calls).toHaveLength(2));

		calls[1]?.resolve({ outcome: "success", response: { data: {} } });
		await waitFor(() =>
			expect(received).toContainEqual({
				outcome: "success",
				requestId: "query-b",
				type: "ryotql-result",
				response: { data: {} },
			}),
		);
		calls[0]?.resolve({ outcome: "failure", reason: "query-failed" });
		await waitFor(() =>
			expect(received).toContainEqual({
				outcome: "failure",
				requestId: "query-a",
				type: "ryotql-result",
				reason: "query-failed",
			}),
		);
		expect(received).toHaveLength(3);
	});

	it("rejects duplicate in-flight IDs across query and operation requests", async () => {
		const query = deferred<PluginRyotQLOutcome>();
		const operationCalls: PluginOperationRequest[] = [];
		const { init, pluginPort, received } = connect({
			onRyotQL: () => query.promise,
			onOperation: (request) => {
				operationCalls.push(request);
				return Promise.resolve({ outcome: "success", value: null });
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({ document, requestId: "shared-id", type: "ryotql-request" });
		pluginPort.postMessage({
			input: null,
			requestId: "shared-id",
			operationSlug: "greet",
			type: "operation-request",
		});
		await delay(10);

		expect(operationCalls).toEqual([]);
		query.resolve({ outcome: "success", response: { data: {} } });
		await waitFor(() => expect(received).toHaveLength(2));
	});

	it("fails the session on a malformed RyotQL request", async () => {
		const calls: PluginRyotQLRequest[] = [];
		const { init, pluginPort, received, failures } = connect({
			onRyotQL: (request) => {
				calls.push(request);
				return Promise.resolve({ outcome: "success", response: { data: {} } });
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			document,
			userId: "user-1",
			requestId: "query-a",
			type: "ryotql-request",
		});
		await waitFor(() => expect(failures).toHaveLength(1));

		expect(calls).toEqual([]);
		expect(received).toEqual([at(), { reason: "failed", type: "lifecycle-close" }]);
	});

	it("aborts a pending RyotQL request and suppresses its late response", async () => {
		let signal: AbortSignal | undefined;
		const call = deferred<PluginRyotQLOutcome>();
		const { init, pluginPort, received, session } = connect({
			onRyotQL: (_request, requestSignal) => {
				signal = requestSignal;
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));
		pluginPort.postMessage({ document, requestId: "query-a", type: "ryotql-request" });
		await waitFor(() => expect(signal).toBeDefined());

		session.close();
		expect(signal?.aborted).toBe(true);
		call.resolve({ outcome: "failure", reason: "transport" });
		await delay(10);

		expect(received).toEqual([at(), { reason: "disposed", type: "lifecycle-close" }]);
	});

	it("cancels matching RyotQL work, releases admission, and ignores cancellation races", async () => {
		const signals: AbortSignal[] = [];
		const calls: Array<ReturnType<typeof deferred<PluginRyotQLOutcome>>> = [];
		const { init, pluginPort, received, failures } = connect({
			onRyotQL: (_request, signal) => {
				signals.push(signal);
				const call = deferred<PluginRyotQLOutcome>();
				calls.push(call);
				return call.promise;
			},
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		for (let index = 0; index < CLIENT_BRIDGE_MAX_PENDING_REQUESTS; index += 1) {
			pluginPort.postMessage({ document, type: "ryotql-request", requestId: `query-${index}` });
		}
		await waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS));

		pluginPort.postMessage({ requestId: "unknown", type: "ryotql-cancel" });
		pluginPort.postMessage({ requestId: "query-0", type: "ryotql-cancel" });
		pluginPort.postMessage({ requestId: "query-0", type: "ryotql-cancel" });
		await waitFor(() => expect(signals[0]?.aborted).toBe(true));
		pluginPort.postMessage({ document, requestId: "replacement", type: "ryotql-request" });
		await waitFor(() => expect(signals).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS + 1));

		calls[0]?.resolve({ outcome: "success", response: { data: {} } });
		calls.at(-1)?.resolve({ outcome: "success", response: { data: {} } });
		await waitFor(() =>
			expect(received).toContainEqual({
				outcome: "success",
				type: "ryotql-result",
				response: { data: {} },
				requestId: "replacement",
			}),
		);

		expect(received).not.toContainEqual(expect.objectContaining({ requestId: "query-0" }));
		expect(failures).toEqual([]);
	});

	it("never posts a Ryot credential, identity, or scope value to the plugin across a full session", async () => {
		const { init, pluginPort, received, session } = connect({
			onOperation: (request) =>
				Promise.resolve(
					request.operationSlug === "fail"
						? ({ outcome: "failure", reason: "operation-failed" } as const)
						: ({ outcome: "success", value: { echoed: request.input } } as const),
				),
		});
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		session.sendLocation(nav({ kind: "route", path: "/details/1", search: "tab=stats" }, 1));

		pluginPort.postMessage({
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
			input: { greeting: "hi" },
		});
		pluginPort.postMessage({
			input: null,
			operationSlug: "fail",
			requestId: "request-2",
			type: "operation-request",
		});

		await waitFor(() => expect(received).toHaveLength(4));

		expect(received).toEqual([
			at(),
			at({ kind: "route", path: "/details/1", search: "tab=stats" }, 1),
			{
				outcome: "success",
				requestId: "request-1",
				type: "operation-result",
				value: { echoed: { greeting: "hi" } },
			},
			{
				outcome: "failure",
				requestId: "request-2",
				type: "operation-result",
				reason: "operation-failed",
			},
		]);
	});
});
