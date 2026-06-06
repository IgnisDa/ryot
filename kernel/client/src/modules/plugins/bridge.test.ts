// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort takes a transfer list, not an origin
import {
	PluginBridgeInit,
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeNavigate,
	type PluginBridgeReady,
	type PluginOperationOutcome,
	type PluginOperationRequest,
} from "@ryot/contract/modules/plugins/client";
import { waitFor } from "@testing-library/dom";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { openPluginBridge, type PluginBridgeSession } from "./bridge";

const decodeInit = Schema.decodeUnknownSync(PluginBridgeInit);

const artifactHash = "artifact-hash";
const home = { path: "/", search: "" };

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
	} = {},
) => {
	const readies: null[] = [];
	const failures: null[] = [];
	const origins: string[] = [];
	const received: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let pluginPort: MessagePort | undefined;
	const navigations: PluginBridgeNavigate[] = [];
	const operationCalls: Array<{
		readonly input: unknown;
		readonly operationSlug: string;
		readonly signal: AbortSignal;
	}> = [];

	const session = openPluginBridge({
		artifactHash,
		location: home,
		timeoutMs: options.timeoutMs,
		onReady: () => readies.push(null),
		onFailure: () => failures.push(null),
		onNavigate: (request) => navigations.push(request),
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
				transferred.addEventListener("message", (event) => received.push(event.data));
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
		session,
		origins,
		readies,
		failures,
		received,
		pluginPort,
		navigations,
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
	it("transfers exactly one port with the exact V1 init markers", () => {
		const { init, origins } = connect();

		expect(origins).toEqual(["*"]);
		expect(init).toEqual({
			artifactHash,
			sessionId: init.sessionId,
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		});
		expect(init.sessionId).not.toBe("");
	});

	it("readies on a matching handshake and then sends the initial location", async () => {
		const { init, pluginPort, readies, failures, received } = connect();

		pluginPort.postMessage(readyFor(init));

		await waitFor(() => {
			expect(readies).toHaveLength(1);
			expect(received).toEqual([{ type: "location", location: home }]);
		});
		expect(failures).toEqual([]);
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
		outdated.pluginPort.postMessage({ ...readyFor(outdated.init), bridgeVersion: 2 });
		await waitFor(() => expect(outdated.failures).toHaveLength(1));

		const premature = connect();
		premature.pluginPort.postMessage({ type: "navigate", mode: "push", location: home });
		await waitFor(() => expect(premature.failures).toHaveLength(1));

		expect(premature.navigations).toEqual([]);
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

		session.sendLocation({ path: "/details/1", search: "" });
		session.sendLocation({ path: "/details/2", search: "tab=stats" });
		pluginPort.postMessage(readyFor(init));

		await waitFor(() =>
			expect(received).toEqual([
				{ type: "location", location: { path: "/details/2", search: "tab=stats" } },
			]),
		);

		session.sendLocation(home);

		await waitFor(() =>
			expect(received).toEqual([
				{ type: "location", location: { path: "/details/2", search: "tab=stats" } },
				{ type: "location", location: home },
			]),
		);
	});

	it("forwards only decoded navigation requests once ready", async () => {
		const { init, pluginPort, navigations, failures } = connect();
		const request = {
			mode: "push",
			type: "navigate",
			location: { path: "/details/1", search: "tab=stats" },
		} satisfies PluginBridgeNavigate;

		pluginPort.postMessage(readyFor(init));
		pluginPort.postMessage({ type: "navigate", mode: "sideways", location: request.location });
		pluginPort.postMessage(request);

		await waitFor(() => expect(navigations).toEqual([request]));
		expect(failures).toEqual([]);
	});

	it("never sends a location after teardown or a failed handshake", async () => {
		const torndown = connect();
		torndown.session.close();
		torndown.session.sendLocation({ path: "/details/1", search: "" });

		const failed = connect({ timeoutMs: 10 });
		await waitFor(() => expect(failed.failures).toHaveLength(1));
		failed.session.sendLocation({ path: "/details/1", search: "" });

		await delay(10);

		expect(torndown.received).toEqual([]);
		expect(failed.received).toEqual([]);
	});

	it("stops delivering after teardown", async () => {
		const { init, pluginPort, readies, failures, session } = connect();

		session.close();
		pluginPort.postMessage(readyFor(init));
		await delay(10);

		expect(readies).toEqual([]);
		expect(failures).toEqual([]);
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

	it("round-trips an expected operation failure", async () => {
		const { init, pluginPort, received } = connect({
			onOperation: () => Promise.resolve({ outcome: "failure", reason: "operation-failed" }),
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
				reason: "operation-failed",
			}),
		);
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

	it("forwards a request that omits input instead of dropping it unanswered", async () => {
		const { init, pluginPort, received, operationCalls } = connect();
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
		});
		await waitFor(() => expect(operationCalls).toHaveLength(1));

		expect(operationCalls[0]).toMatchObject({ input: undefined, operationSlug: "greet" });
	});

	it("never invokes onOperation for a request carrying extra identity fields", async () => {
		const { init, pluginPort, received, operationCalls } = connect();
		pluginPort.postMessage(readyFor(init));
		await waitFor(() => expect(received).toHaveLength(1));

		pluginPort.postMessage({
			input: null,
			requestId: "request-1",
			operationSlug: "greet",
			type: "operation-request",
			installationId: "installation-2",
		});
		pluginPort.postMessage({
			input: null,
			requestId: "request-2",
			operationSlug: "greet",
			type: "operation-request",
			pluginSlug: "another-plugin",
		});
		await delay(10);

		expect(operationCalls).toEqual([]);
		expect(received).toHaveLength(1);
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

		expect(received).toHaveLength(1);
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

		session.sendLocation({ path: "/details/1", search: "tab=stats" });

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
			{ type: "location", location: home },
			{ type: "location", location: { path: "/details/1", search: "tab=stats" } },
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
