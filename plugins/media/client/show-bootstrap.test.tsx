// @vitest-environment jsdom

import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeInit,
} from "@ryot-app/client-plugin-contract";
import { bootstrapClientPage } from "@ryot-app/client-sdk/plugin";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";
import { fireEvent, waitFor } from "@testing-library/dom";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import ShowDetailPage from "./show/screen";

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
	safeAreaBottom: 0,
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
	pageInfo: { limit: 1, hasMore: false, nextCursor: null },
});

const emptyOverviewResponse = {
	data: { people: rows([]), companies: rows([]), recommendations: rows([]) },
};

const readyResponse = {
	data: {
		requested: rows([{ schemaSlug: "show" }]),
		show: rows([
			{
				owned: null,
				id: "show-1",
				totalSeasons: 2,
				totalEpisodes: 12,
				publishYear: 2025,
				state: "complete",
				publishDate: null,
				isInLibrary: false,
				isMonitored: false,
				schemaSlug: "show",
				name: "Tracer Show",
				providerName: "TMDB",
				providerRating: null,
				watchProviders: null,
				populationStatus: "ready",
				translationStatus: "none",
				genres: ["Drama", "Mystery"],
				productionStatus: "Returning Series",
				description: "A deterministic show description.",
				collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
				images: [
					{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
					{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
				],
			},
		]),
	},
};

const responseWithImages = (images: readonly Record<string, unknown>[]) => ({
	data: {
		requested: rows([{ schemaSlug: "show" }]),
		show: rows([{ ...readyResponse.data.show.items[0], images }]),
	},
});

type AssetLocator = { readonly key: string; readonly type: "local" | "s3" };

type AssetRequest = {
	readonly requestId: string;
	readonly type: "asset-request";
	readonly assets: readonly AssetLocator[];
};

type AssetCancel = { readonly requestId: string; readonly type: "asset-cancel" };

type AssetResolution = {
	readonly url: string;
	readonly expiresAt: string;
	readonly asset: AssetLocator;
};

type RyotQLRequest = {
	readonly requestId: string;
	readonly type: "ryotql-request";
	readonly document: { readonly queries: Record<string, unknown> };
};

type Bootstrap = ReturnType<typeof bootstrapClientPage>;

const bootstraps: Bootstrap[] = [];
const channels: MessageChannel[] = [];
const clocks: ReturnType<typeof createTestRyotClock>[] = [];

// Retargets the bootstrap runtime factory, so the page `openShow` boots after this call schedules
// on the returned test clock. Create it before `openShow`.
const openTestClock = () => {
	const clock = createTestRyotClock();
	clocks.push(clock);
	return clock;
};

const openShow = () => {
	document.body.innerHTML = '<div id="app"></div>';
	const metadataElement = document.createElement("script");
	metadataElement.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
	metadataElement.type = "application/json";
	metadataElement.textContent = JSON.stringify(metadata);
	document.head.append(metadataElement);

	bootstraps.push(bootstrapClientPage(ShowDetailPage));
	const channel = new MessageChannel();
	channels.push(channel);
	const messages: unknown[] = [];
	channel.port1.addEventListener("message", ({ data }) => messages.push(data));
	channel.port1.start();
	window.dispatchEvent(
		new MessageEvent("message", {
			source: window.parent,
			ports: [channel.port2],
			data: {
				...init,
				page: {
					view: null,
					settings: {},
					dataSources: null,
					route: { params: {} },
					renderer: { kind: "plugin", pluginId: "media", exportName: "show-detail" },
					target: {
						kind: "entity",
						entityId: "show-1",
						entitySchemaSlug: "show",
						entitySchemaPluginId: "media",
					},
				},
			},
		}),
	);
	channel.port1.postMessage({
		index: 0,
		key: "show-1",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
		location: { search: "", kind: "entity", entityId: "show-1", entitySchemaSlug: "show" },
	});
	return { channel, messages, container: document.getElementById("app") };
};

const queryRequests = (messages: readonly unknown[]) =>
	messages.filter(
		(message): message is RyotQLRequest =>
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "ryotql-request" &&
			"requestId" in message &&
			typeof message.requestId === "string" &&
			"document" in message,
	);

const queryRequestsFor = (messages: readonly unknown[], key: string) =>
	queryRequests(messages).filter((request) => key in request.document.queries);

const queryRequestFor = (messages: readonly unknown[], key: string, index = 0) => {
	const request = queryRequestsFor(messages, key)[index];
	if (request === undefined) {
		throw new Error(`Expected a RyotQL request for "${key}" at index ${index}`);
	}
	return request;
};

const assetRequests = (messages: readonly unknown[]) =>
	messages.filter(
		(message): message is AssetRequest =>
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "asset-request" &&
			"requestId" in message &&
			typeof message.requestId === "string" &&
			"assets" in message &&
			Array.isArray(message.assets),
	);

const assetRequestAt = (messages: readonly unknown[], index: number) => {
	const request = assetRequests(messages)[index];
	if (request === undefined) {
		throw new Error(`Expected asset request at index ${index}`);
	}
	return request;
};

const assetCancels = (messages: readonly unknown[]) =>
	messages.filter(
		(message): message is AssetCancel =>
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "asset-cancel" &&
			"requestId" in message &&
			typeof message.requestId === "string",
	);

const reply = (
	channel: MessageChannel,
	requestId: string,
	result:
		| { readonly outcome: "failure"; readonly reason: "query-failed" }
		| { readonly outcome: "success"; readonly response: unknown },
) => channel.port1.postMessage({ requestId, type: "ryotql-result", ...result });

const assetReply = (
	channel: MessageChannel,
	requestId: string,
	result:
		| { readonly outcome: "failure"; readonly reason: "asset-failed" }
		| { readonly outcome: "success"; readonly resolutions: readonly AssetResolution[] },
) => channel.port1.postMessage({ requestId, type: "asset-result", ...result });

const replyOverview = (channel: MessageChannel, messages: readonly unknown[], index = 0) =>
	reply(channel, queryRequestFor(messages, "people", index).requestId, {
		outcome: "success",
		response: emptyOverviewResponse,
	});

const managedCoverImage = (container: HTMLElement | null) =>
	Array.from(container?.querySelectorAll('img[loading="lazy"]') ?? []).find((image) =>
		(image.getAttribute("src") ?? "").includes("assets.test"),
	);

const flush = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

afterEach(async () => {
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
	await Promise.all(clocks.map((clock) => clock.dispose()));
	clocks.length = 0;
});

describe("ShowScreen", () => {
	it("queries the live entity after same-document entity navigation", async () => {
		const { channel, messages } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		channel.port1.postMessage({
			index: 1,
			key: "show-2",
			compact: false,
			edgeBack: true,
			leading: "back",
			type: "location",
			location: { search: "", kind: "entity", entityId: "show-2", entitySchemaSlug: "show" },
		});
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(2));
		expect(JSON.stringify(queryRequestsFor(messages, "show")[1]?.document)).toContain("show-2");
	});

	it("renders pending status while the summary and overview queries are in flight", async () => {
		const { messages, container } = openShow();

		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		await waitFor(() => expect(queryRequestsFor(messages, "people")).toHaveLength(1));
		expect(container?.textContent).toContain("Loading show...");
	});

	it("renders an error and retries through the query result", async () => {
		const { channel, messages, container } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "failure",
			reason: "query-failed",
		});
		await waitFor(() => expect(container?.textContent).toContain("Unable to load this show"));

		const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the Show retry button");
		}
		fireEvent.click(retry);
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(2));
		reply(channel, queryRequestFor(messages, "show", 1).requestId, {
			outcome: "success",
			response: readyResponse,
		});

		await waitFor(() => expect(container?.textContent).toContain("Tracer Show"));
	});

	it("renders the missing state", async () => {
		const missing = openShow();
		await waitFor(() => expect(queryRequestsFor(missing.messages, "show")).toHaveLength(1));
		reply(missing.channel, queryRequestFor(missing.messages, "show").requestId, {
			outcome: "success",
			response: { data: { show: rows([]), requested: rows([]) } },
		});
		await waitFor(() =>
			expect(missing.container?.textContent).toContain("This entity no longer exists."),
		);
	});

	it("renders the wrong-schema state", async () => {
		const wrongSchema = openShow();
		await waitFor(() => expect(queryRequestsFor(wrongSchema.messages, "show")).toHaveLength(1));
		reply(wrongSchema.channel, queryRequestFor(wrongSchema.messages, "show").requestId, {
			outcome: "success",
			response: { data: { show: rows([]), requested: rows([{ schemaSlug: "movie" }]) } },
		});
		await waitFor(() =>
			expect(wrongSchema.container?.textContent).toContain(
				"This entity is not a show, and only shows can be opened here.",
			),
		);
	});

	it("renders seeded summary fields and publishes the Show title", async () => {
		const { channel, messages, container } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "success",
			response: readyResponse,
		});
		await waitFor(() => expect(queryRequestsFor(messages, "people")).toHaveLength(1));
		replyOverview(channel, messages);

		await waitFor(() => expect(container?.textContent).toContain("Tracer Show"));
		expect(container?.textContent).toContain("TMDB");
		expect(container?.textContent).toContain("Drama");
		expect(container?.textContent).toContain("Returning Series");
		expect(container?.textContent).toContain("Seasons");
		expect(container?.textContent).toContain("A deterministic show description.");
		expect(
			Array.from(container?.querySelectorAll("img") ?? []).map((image) =>
				image.getAttribute("src"),
			),
		).toEqual([
			"https://images.test/backdrop.jpg",
			"https://images.test/cover.jpg",
			"https://images.test/backdrop.jpg",
			"https://images.test/cover.jpg",
		]);
		expect(assetRequests(messages)).toHaveLength(0);
		await waitFor(() =>
			expect(messages).toContainEqual({
				index: 0,
				key: "show-1",
				type: "header",
				header: { title: "Tracer Show" },
			}),
		);
	});

	it("renders a managed cover placeholder before resolving its signed URL", async () => {
		const { channel, messages, container } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "success",
			response: responseWithImages([
				{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
				{ type: "local", purpose: "cover", key: "managed-cover" },
			]),
		});

		await waitFor(() => expect(assetRequests(messages)).toHaveLength(1));
		expect(assetRequestAt(messages, 0).assets).toEqual([{ type: "local", key: "managed-cover" }]);
		expect(managedCoverImage(container)).toBeUndefined();

		const signedUrl = "https://assets.test/managed-cover-v1?signature=one";
		assetReply(channel, assetRequestAt(messages, 0).requestId, {
			outcome: "success",
			resolutions: [
				{
					url: signedUrl,
					asset: { type: "local", key: "managed-cover" },
					expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
				},
			],
		});

		await waitFor(() => expect(managedCoverImage(container)?.getAttribute("src")).toBe(signedUrl));
	});

	it("shows an unavailable managed cover after the initial asset request fails", async () => {
		const { channel, messages, container } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "success",
			response: responseWithImages([{ type: "local", purpose: "cover", key: "managed-cover" }]),
		});
		await waitFor(() => expect(assetRequests(messages)).toHaveLength(1));

		assetReply(channel, assetRequestAt(messages, 0).requestId, {
			outcome: "failure",
			reason: "asset-failed",
		});

		await flush();
		expect(managedCoverImage(container)).toBeUndefined();
	});

	it("refreshes one minute before expiry and keeps the stale URL after failure", async () => {
		const clock = openTestClock();
		const { channel, messages, container } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "success",
			response: responseWithImages([{ type: "local", purpose: "cover", key: "managed-cover" }]),
		});
		await waitFor(() => expect(assetRequests(messages)).toHaveLength(1));

		await clock.setTime(Date.parse("2026-09-04T12:00:00.000Z"));
		const expiresAt = new Date("2026-09-04T12:05:00.000Z").toISOString();
		const staleUrl = "https://assets.test/managed-cover-v1?signature=stale";
		assetReply(channel, assetRequestAt(messages, 0).requestId, {
			outcome: "success",
			resolutions: [{ expiresAt, url: staleUrl, asset: { type: "local", key: "managed-cover" } }],
		});
		await flush();
		expect(managedCoverImage(container)?.getAttribute("src")).toBe(staleUrl);

		await clock.advance(4 * 60_000 - 1);
		expect(assetRequests(messages)).toHaveLength(1);
		await clock.advance(1);
		await flush();
		expect(assetRequests(messages)).toHaveLength(2);

		assetReply(channel, assetRequestAt(messages, 1).requestId, {
			outcome: "failure",
			reason: "asset-failed",
		});
		await flush();
		expect(managedCoverImage(container)?.getAttribute("src")).toBe(staleUrl);
	});

	it("cancels a managed cover request when its screen unmounts", async () => {
		const { channel, messages } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "success",
			response: responseWithImages([{ type: "local", purpose: "cover", key: "managed-cover" }]),
		});
		await waitFor(() => expect(assetRequests(messages)).toHaveLength(1));

		channel.port1.postMessage({
			index: 2,
			compact: false,
			edgeBack: false,
			leading: "none",
			type: "location",
			key: "replacement",
			location: { search: "", kind: "route", path: "/replacement" },
		});

		await waitFor(() => expect(assetCancels(messages)).toHaveLength(1));
		expect(assetCancels(messages)[0]).toEqual({
			type: "asset-cancel",
			requestId: assetRequestAt(messages, 0).requestId,
		});
	});

	it("omits absent optional fields", async () => {
		const { channel, messages, container } = openShow();
		await waitFor(() => expect(queryRequestsFor(messages, "show")).toHaveLength(1));
		reply(channel, queryRequestFor(messages, "show").requestId, {
			outcome: "success",
			response: {
				data: {
					requested: rows([{ schemaSlug: "show" }]),
					show: rows([
						{
							owned: null,
							id: "show-1",
							genres: null,
							images: null,
							publishYear: null,
							description: null,
							publishDate: null,
							state: "untracked",
							totalSeasons: null,
							providerName: null,
							isInLibrary: false,
							isMonitored: false,
							schemaSlug: "show",
							name: "Sparse Show",
							totalEpisodes: null,
							providerRating: null,
							watchProviders: null,
							productionStatus: null,
							populationStatus: "none",
							translationStatus: "none",
							collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
						},
					]),
				},
			},
		});

		await waitFor(() => expect(container?.textContent).toContain("Sparse Show"));
		expect(container?.textContent).not.toContain("Production status");
		expect(container?.textContent).not.toContain("Seasons");
		expect(container?.querySelector("img")).toBeNull();
	});
});
