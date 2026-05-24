// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort takes a transfer list, not an origin
import {
	PluginBridgeInit,
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeNavigate,
	type PluginBridgeReady,
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

const connect = (options: { readonly timeoutMs?: number } = {}) => {
	const readies: null[] = [];
	const failures: null[] = [];
	const origins: string[] = [];
	const received: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let pluginPort: MessagePort | undefined;
	const navigations: PluginBridgeNavigate[] = [];

	const session = openPluginBridge({
		artifactHash,
		location: home,
		timeoutMs: options.timeoutMs,
		onReady: () => readies.push(null),
		onFailure: () => failures.push(null),
		onNavigate: (request) => navigations.push(request),
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
	return { init, pluginPort, origins, readies, failures, received, navigations, session };
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
});
