import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeInit,
} from "@ryot/contract/modules/plugins/client";
import { waitFor } from "@testing-library/dom";
import { afterAll, describe, expect, it } from "vitest";

import { bootstrapClientPlugin, defineClientPlugin } from "./index";

const artifactMetadata = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

const init: PluginBridgeInit = {
	sessionId: "session-id",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	artifactHash: artifactMetadata.hash,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

const channels: Array<{ channel: MessageChannel; messages: unknown[] }> = [];
const FixtureHome = () => <p>Fixture home</p>;

const dispatchInit = (data: unknown, ports: MessagePort[], source: MessageEventSource | null) =>
	window.dispatchEvent(new MessageEvent("message", { data, ports, source }));

const openChannel = () => {
	const channel = new MessageChannel();
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	const recording = { channel, messages };
	channels.push(recording);
	return recording;
};

const settleMessages = () => new Promise((resolve) => setTimeout(resolve, 0));

afterAll(() => {
	for (const {
		channel: { port1, port2 },
	} of channels) {
		port1.close();
		port2.close();
	}
});

describe("client plugin SDK", () => {
	it("freezes a typed home definition", () => {
		const definition = defineClientPlugin({ home: FixtureHome });

		expect(definition).toEqual({ home: FixtureHome });
		expect(Object.isFrozen(definition)).toBe(true);
	});

	it("rejects invalid init messages, then readies and mounts only the first valid init", async () => {
		document.body.innerHTML = "";
		const definition = defineClientPlugin({ home: FixtureHome });
		bootstrapClientPlugin(definition, artifactMetadata);

		const nonParent = openChannel();
		const foreignFrame = document.createElement("iframe");
		document.body.append(foreignFrame);
		dispatchInit(init, [nonParent.channel.port2], foreignFrame.contentWindow);
		foreignFrame.remove();

		dispatchInit(init, [], window.parent);

		const multiplePorts = openChannel();
		const extraPort = openChannel();
		dispatchInit(init, [multiplePorts.channel.port2, extraPort.channel.port2], window.parent);

		const malformed = openChannel();
		dispatchInit({}, [malformed.channel.port2], window.parent);

		const excess = openChannel();
		dispatchInit({ ...init, excess: true }, [excess.channel.port2], window.parent);

		for (const mismatch of [
			{ artifactHash: "other-hash" },
			{ format: 2 },
			{ apiVersion: 2 },
			{ bridgeVersion: 2 },
			{ compilerVersion: 2 },
		]) {
			const mismatched = openChannel();
			dispatchInit({ ...init, ...mismatch }, [mismatched.channel.port2], window.parent);
		}

		const missingRoot = openChannel();
		dispatchInit(init, [missingRoot.channel.port2], window.parent);
		await settleMessages();

		expect(document.body.innerHTML).toBe("");
		for (const { messages } of channels) {
			expect(messages).toEqual([]);
		}

		document.body.innerHTML = '<div id="app"></div>';
		const valid = openChannel();
		dispatchInit(init, [valid.channel.port2], window.parent);

		await waitFor(() => {
			expect(valid.messages).toEqual([
				{
					sessionId: init.sessionId,
					format: CLIENT_ARTIFACT_FORMAT,
					apiVersion: CLIENT_API_VERSION,
					artifactHash: artifactMetadata.hash,
					compilerVersion: CLIENT_COMPILER_VERSION,
					bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
				},
			]);
			expect(document.getElementById("app")?.textContent).toBe("Fixture home");
		});

		const second = openChannel();
		dispatchInit({ ...init, sessionId: "second-session" }, [second.channel.port2], window.parent);
		await settleMessages();

		expect(second.messages).toEqual([]);
		expect(document.getElementById("app")?.textContent).toBe("Fixture home");
	});
});
