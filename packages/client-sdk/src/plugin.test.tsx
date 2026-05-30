import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	REQUIRED_THEME_TOKEN_NAMES,
	type PluginBridgeInit,
} from "@ryot/contract/modules/plugins/client";
import { waitFor } from "@testing-library/dom";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { bootstrapClientPlugin, defineClientPlugin } from "./plugin";
import * as pluginSurface from "./plugin";
import { useRyot } from "./react";

const metadata = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
};
const init: PluginBridgeInit = {
	format: metadata.format,
	sessionId: "session-id",
	artifactHash: metadata.hash,
	apiVersion: metadata.apiVersion,
	bridgeVersion: metadata.bridgeVersion,
	compilerVersion: metadata.compilerVersion,
};
const tokens = Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name]));
const theme = { resolvedMode: "light", tokens };
let channels: MessageChannel[] = [];
let bootstraps: Array<{ dispose: () => void }> = [];

const Home = () => {
	const ryot = useRyot();
	const [result, setResult] = useState("pending");
	useEffect(() => {
		void ryot.operations
			.invoke({ slug: "greet", input: {}, output: Schema.String })
			.then(setResult);
	}, [ryot]);
	return <p>{result}</p>;
};

const StaticHome = () => <p>Mounted</p>;

const embedMetadata = () => {
	const element = document.createElement("script");
	element.type = "application/json";
	element.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
	element.textContent = JSON.stringify(metadata);
	document.head.append(element);
};

afterEach(() => {
	for (const bootstrap of bootstraps) {
		bootstrap.dispose();
	}
	for (const channel of channels) {
		channel.port1.close();
		channel.port2.close();
	}
	channels = [];
	bootstraps = [];
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("bootstrapClientPlugin", () => {
	it("does not expose the removed navigation hook", () => {
		expect(pluginSurface).not.toHaveProperty("usePluginNavigation");
	});

	it("does not register a session without valid embedded metadata", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		bootstraps.push(bootstrapClientPlugin(defineClientPlugin({ home: Home })));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, ports: [channel.port2], source: window.parent }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(messages).toEqual([]);
	});

	it("creates one session client and supplies it through RyotProvider", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin(defineClientPlugin({ home: Home })));
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, ports: [channel.port2], source: window.parent }),
		);
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		channel.port1.postMessage({ generation: 1, type: "theme", theme });
		await waitFor(() =>
			expect(messages).toContainEqual(
				expect.objectContaining({ type: "operation-request", requestId: "operation-1" }),
			),
		);
		channel.port1.postMessage({
			value: "Hello",
			outcome: "success",
			type: "operation-result",
			requestId: "operation-1",
		});
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Hello"));
	});

	it("does not mount plugin React before initial location and theme", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin(defineClientPlugin({ home: StaticHome })));
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, ports: [channel.port2], source: window.parent }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.getElementById("app")?.textContent).toBe("");

		channel.port1.postMessage({ generation: 1, type: "theme", theme });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.getElementById("app")?.textContent).toBe("");

		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));
	});

	it("removes its window listener when disposed before initialization", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		const bootstrap = bootstrapClientPlugin(defineClientPlugin({ home: Home }));
		bootstrap.dispose();
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();

		window.dispatchEvent(
			new MessageEvent("message", { data: init, ports: [channel.port2], source: window.parent }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(messages).toEqual([]);
	});

	it("unmounts the React root when the host disposes the runtime", async () => {
		document.body.innerHTML = '<div id="app"></div>';
		embedMetadata();
		bootstraps.push(bootstrapClientPlugin(defineClientPlugin({ home: StaticHome })));
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.start();
		window.dispatchEvent(
			new MessageEvent("message", { data: init, ports: [channel.port2], source: window.parent }),
		);
		channel.port1.postMessage({ type: "location", location: { path: "/", search: "" } });
		channel.port1.postMessage({ generation: 1, type: "theme", theme });
		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("Mounted"));

		channel.port1.postMessage({ reason: "disposed", type: "lifecycle-close" });

		await waitFor(() => expect(document.getElementById("app")?.textContent).toBe(""));
	});
});
