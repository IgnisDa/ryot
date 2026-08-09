// @vitest-environment jsdom

import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeInit,
} from "@ryot-app/contract/modules/plugins/client";
import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { ShowEntityScreen } from "./show-entity";

const metadata = {
	hash: "media-artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

const init: PluginBridgeInit = {
	mode: "light",
	safeAreaTop: 0,
	format: metadata.format,
	artifactHash: metadata.hash,
	sessionId: "media-session-id",
	apiVersion: metadata.apiVersion,
	bridgeVersion: metadata.bridgeVersion,
	compilerVersion: metadata.compilerVersion,
};

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows",
	pageInfo: { hasMore: false, limit: 1, nextCursor: null },
});

const readyResponse = {
	data: {
		requested: rows([{ entitySchemaSlug: "show" }]),
		show: rows([
			{
				id: "show-1",
				totalSeasons: 2,
				totalEpisodes: 12,
				publishYear: 2025,
				name: "Tracer Show",
				providerName: "TMDB",
				genres: ["Drama", "Mystery"],
				productionStatus: "Returning Series",
				description: "A deterministic show description.",
				images: [
					{ type: "remote", url: "https://images.test/backdrop.jpg", purpose: "backdrop" },
					{ type: "remote", url: "https://images.test/cover.jpg", purpose: "cover" },
				],
			},
		]),
	},
};

type Bootstrap = ReturnType<typeof bootstrapClientPlugin>;

const bootstraps: Bootstrap[] = [];
const channels: MessageChannel[] = [];

const Home = () => <p>Media</p>;

const openShow = () => {
	document.body.innerHTML = '<div id="app"></div>';
	const metadataElement = document.createElement("script");
	metadataElement.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
	metadataElement.type = "application/json";
	metadataElement.textContent = JSON.stringify(metadata);
	document.head.append(metadataElement);

	bootstraps.push(
		bootstrapClientPlugin({
			home: { component: Home },
			entities: { show: { component: ShowEntityScreen } },
		}),
	);
	const channel = new MessageChannel();
	channels.push(channel);
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	window.dispatchEvent(
		new MessageEvent("message", { data: init, ports: [channel.port2], source: window.parent }),
	);
	channel.port1.postMessage({
		index: 0,
		key: "show-1",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
		location: { entityId: "show-1", entitySchemaSlug: "show", kind: "entity" },
	});
	return { channel, messages, container: document.getElementById("app") };
};

const queryRequests = (messages: readonly unknown[]) =>
	messages.filter(
		(message): message is { readonly requestId: string; readonly type: "ryotql-request" } =>
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "ryotql-request" &&
			"requestId" in message &&
			typeof message.requestId === "string",
	);

const queryRequestAt = (messages: readonly unknown[], index: number) => {
	const request = queryRequests(messages)[index];
	if (request === undefined) {
		throw new Error(`Expected RyotQL request at index ${index}`);
	}
	return request;
};

const reply = (
	channel: MessageChannel,
	requestId: string,
	result:
		| { readonly outcome: "failure"; readonly reason: "query-failed" }
		| { readonly outcome: "success"; readonly response: unknown },
) => channel.port1.postMessage({ type: "ryotql-result", requestId, ...result });

afterEach(() => {
	for (const bootstrap of bootstraps) {
		bootstrap.dispose();
	}
	for (const channel of channels) {
		channel.port1.close();
		channel.port2.close();
	}
	bootstraps.length = 0;
	channels.length = 0;
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("ShowEntityScreen", () => {
	it("renders pending status while the query is in flight", async () => {
		const { container } = openShow();

		await waitFor(() => expect(container?.textContent).toContain("Loading show..."));
	});

	it("renders an error and retries through the query result", async () => {
		const { channel, container, messages } = openShow();
		await waitFor(() => expect(queryRequests(messages)).toHaveLength(1));
		reply(channel, queryRequestAt(messages, 0).requestId, {
			outcome: "failure",
			reason: "query-failed",
		});
		await waitFor(() => expect(container?.textContent).toContain("Unable to load this show."));

		const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the Show retry button");
		}
		fireEvent.click(retry);
		await waitFor(() => expect(queryRequests(messages)).toHaveLength(2));
		reply(channel, queryRequestAt(messages, 1).requestId, {
			outcome: "success",
			response: readyResponse,
		});

		await waitFor(() => expect(container?.textContent).toContain("Tracer Show"));
	});

	it("renders the missing state", async () => {
		const missing = openShow();
		await waitFor(() => expect(queryRequests(missing.messages)).toHaveLength(1));
		reply(missing.channel, queryRequestAt(missing.messages, 0).requestId, {
			outcome: "success",
			response: { data: { requested: rows([]), show: rows([]) } },
		});
		await waitFor(() =>
			expect(missing.container?.textContent).toContain("This entity no longer exists."),
		);
	});

	it("renders the wrong-schema state", async () => {
		const wrongSchema = openShow();
		await waitFor(() => expect(queryRequests(wrongSchema.messages)).toHaveLength(1));
		reply(wrongSchema.channel, queryRequestAt(wrongSchema.messages, 0).requestId, {
			outcome: "success",
			response: {
				data: { requested: rows([{ entitySchemaSlug: "movie" }]), show: rows([]) },
			},
		});
		await waitFor(() =>
			expect(wrongSchema.container?.textContent).toContain("This entity is not a Show."),
		);
	});

	it("renders seeded summary fields and publishes the Show title", async () => {
		const { channel, container, messages } = openShow();
		await waitFor(() => expect(queryRequests(messages)).toHaveLength(1));
		reply(channel, queryRequestAt(messages, 0).requestId, {
			outcome: "success",
			response: readyResponse,
		});

		await waitFor(() => expect(container?.textContent).toContain("Tracer Show"));
		expect(container?.textContent).toContain("TV Show · TMDB · 2025");
		expect(container?.textContent).toContain("Drama");
		expect(container?.textContent).toContain("Returning Series");
		expect(container?.textContent).toContain("2 seasons");
		expect(container?.textContent).toContain("12 episodes");
		expect(container?.textContent).toContain("A deterministic show description.");
		expect(
			Array.from(container?.querySelectorAll("img") ?? []).map((image) =>
				image.getAttribute("src"),
			),
		).toEqual(["https://images.test/backdrop.jpg", "https://images.test/cover.jpg"]);
		expect(
			Array.from(container?.querySelectorAll("h1") ?? []).map((heading) => heading.textContent),
		).toEqual(["Tracer Show"]);
		await waitFor(() =>
			expect(messages).toContainEqual({
				index: 0,
				key: "show-1",
				type: "header",
				header: { title: "Tracer Show" },
			}),
		);
	});

	it("omits absent optional fields", async () => {
		const { channel, container, messages } = openShow();
		await waitFor(() => expect(queryRequests(messages)).toHaveLength(1));
		reply(channel, queryRequestAt(messages, 0).requestId, {
			outcome: "success",
			response: {
				data: {
					requested: rows([{ entitySchemaSlug: "show" }]),
					show: rows([
						{
							id: "show-1",
							genres: null,
							images: null,
							publishYear: null,
							description: null,
							totalSeasons: null,
							providerName: null,
							name: "Sparse Show",
							totalEpisodes: null,
							productionStatus: null,
						},
					]),
				},
			},
		});

		await waitFor(() => expect(container?.textContent).toContain("Sparse Show"));
		expect(container?.textContent).toContain("TV Show");
		expect(container?.textContent).not.toContain("Production status");
		expect(container?.textContent).not.toContain("Seasons");
		expect(container?.textContent).not.toContain("Episodes");
		expect(container?.querySelector("img")).toBeNull();
	});
});
