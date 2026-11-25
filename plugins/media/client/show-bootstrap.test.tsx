import { afterEach, describe, expect } from "bun:test";

import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginBridgeInit,
	PluginBridgeRyotQLRequest,
} from "@ryot-app/plugin-client-contract";
import { DateTime, Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import {
	createTestRyotClock,
	pluginContributor,
	startTestPluginBridge,
	testBridgeLocale,
} from "@ryot-app/plugin-client-sdk/testing";
import { bindTestRequest, requireInlineDocument } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { act } from "react";

import type { MediaImage } from "../shared/media-image";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { servedProviderName } from "../tests/client/served-names";
import { artworkSummaryFixture } from "../tests/client/summary-fixture";
import { mediaMessages } from "../tests/client/test-support";
import { ryotqlDocumentNodes } from "../tests/ryotql-test-utils";
import ShowDetailPage from "./show/screen";

const metadata = {
	hash: "media-artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

const init: PluginBridgeInit = {
	...testBridgeLocale([mediaMessages("media-owner")]),
	mode: "light",
	safeAreaTop: 0,
	safeAreaBottom: 0,
	format: metadata.format,
	documentKey: "show-document",
	sessionId: "media-session-id",
	compositionHash: metadata.hash,
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
		summary: rows([
			{
				owned: false,
				id: "show-1",
				ownedEpisodes: 0,

				totalSeasons: 2,
				isCustom: false,
				totalEpisodes: 12,
				publishYear: 2025,
				state: "complete",
				publishDate: null,
				airedEpisodes: 12,
				watchedEpisodes: 3,
				isMonitored: false,
				schemaSlug: "show",
				upcomingEpisodes: 0,
				name: "Tracer Show",
				providerRating: null,
				watchProviders: null,
				inProgressEpisodes: 0,
				originalLanguage: null,
				providerCheckedAt: null,
				isInMediaLibrary: false,
				productionStatus: "Returning Series",
				providerName: servedProviderName("tmdb"),
				description: "A deterministic show description.",
				translationStatus: { state: "idle", availability: "none" },
				nextUp: { items: [], pageInfo: { limit: 1, hasMore: false } },
				populationStatus: { state: "succeeded", availability: "complete" },
				collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
				relatedPopulationStatus: { state: "succeeded", availability: "complete" },
				genres: {
					pageInfo: { limit: 100, hasMore: false },
					items: [
						{ name: "Drama", id: "genre-drama" },
						{ name: "Mystery", id: "genre-mystery" },
					],
				},
				...artworkSummaryFixture([
					{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
					{ type: "remote", purpose: "cover", url: "https://images.test/cover.jpg" },
				]),
			},
		]),
	},
};

const responseWithImages = (images: readonly MediaImage[]) => ({
	data: {
		requested: rows([{ schemaSlug: "show" }]),
		summary: rows([{ ...readyResponse.data.summary.items[0], ...artworkSummaryFixture(images) }]),
	},
});

type AssetLocator = { readonly key: string; readonly type: "s3" | "local" };

type AssetCancel = { readonly requestId: string; readonly type: "asset-cancel" };

type AssetResolution = {
	readonly url: string;
	readonly expiresAt: string;
	readonly asset: AssetLocator;
};

type AssetRequest = {
	readonly requestId: string;
	readonly type: "asset-request";
	readonly assets: readonly AssetLocator[];
};

const bootstraps: ReturnType<typeof startTestPluginBridge>[] = [];
const clocks: ReturnType<typeof createTestRyotClock>[] = [];

const openTestClock = () => {
	const clock = createTestRyotClock();
	clocks.push(clock);
	return clock;
};

const openShow = (clock?: ReturnType<typeof createTestRyotClock>) => {
	document.body.innerHTML = '<div id="app"></div>';
	const bootstrap = startTestPluginBridge(
		(offer) => (clock ?? openTestClock()).bootstrap.bootstrapClientPage(ShowDetailPage, {}, offer),
		metadata,
	);
	bootstraps.push(bootstrap);
	const { port } = bootstrap;
	const messages: unknown[] = [];
	port.addEventListener("message", ({ data }) => messages.push(data));
	port.start();
	port.postMessage({
		...init,
		page: {
			view: null,
			settings: {},
			dataSources: null,
			route: { params: {} },
			renderer: { kind: "plugin", pluginId: "media-owner", exportName: "show-detail" },
			contributors: [
				pluginContributor({ name: "media", pluginId: "media-owner", packageId: PLUGIN_PACKAGE_ID }),
			],
			target: {
				kind: "entity",
				entityId: "show-1",
				entitySchemaSlug: "show",
				entitySchemaPluginId: "media-owner",
			},
		},
	});
	port.postMessage({
		index: 0,
		key: "show-1",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
		location: { search: "", kind: "entity", entityId: "show-1", entitySchemaSlug: "show" },
	});
	return { port, messages, container: document.getElementById("app") };
};

const queryRequests = (messages: readonly unknown[]) =>
	messages.flatMap((message) => {
		const decoded = Schema.decodeUnknownResult(PluginBridgeRyotQLRequest)(message);
		return Result.isSuccess(decoded) && decoded.success.action === "execute"
			? [decoded.success]
			: [];
	});

const queryRequestsFor = (messages: readonly unknown[], key: string) =>
	queryRequests(messages).filter(
		(request) => key in requireInlineDocument(request.request).queries,
	);

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
	port: MessagePort,
	requestId: string,
	result:
		| { readonly response: unknown; readonly outcome: "success" }
		| { readonly outcome: "failure"; readonly reason: "query-failed" },
) => port.postMessage({ requestId, type: "ryotql-result", ...result });

const assetReply = (
	port: MessagePort,
	requestId: string,
	result:
		| { readonly outcome: "failure"; readonly reason: "asset-failed" }
		| { readonly outcome: "success"; readonly resolutions: readonly AssetResolution[] },
) => port.postMessage({ requestId, type: "asset-result", ...result });

const replyOverview = (port: MessagePort, messages: readonly unknown[], index = 0) =>
	reply(port, queryRequestFor(messages, "people", index).requestId, {
		outcome: "success",
		response: emptyOverviewResponse,
	});

const managedCoverImage = (container: null | HTMLElement) =>
	Array.from(container?.querySelectorAll('img[loading="lazy"]') ?? []).find((image) =>
		(image.getAttribute("src") ?? "").includes("assets.test"),
	);

const flush = () =>
	act(() =>
		Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.promise(() => Promise.resolve());
				yield* Effect.promise(() => Promise.resolve());
			}),
		),
	);

afterEach(() => {
	for (const bootstrap of bootstraps) {
		bootstrap.dispose();
	}
	bootstraps.length = 0;
	document.head.innerHTML = "";
	document.body.innerHTML = "";
	return Effect.runPromise(
		Effect.andThen(
			Effect.forEach(clocks, (clock) => Effect.promise(() => clock.dispose()), {
				discard: true,
				concurrency: "unbounded",
			}),
			Effect.sync(() => {
				clocks.length = 0;
			}),
		),
	);
});

describe("ShowScreen", () => {
	it.live(
		"queries the live entity after same-document entity navigation",
		() =>
			Effect.gen(function* () {
				const { port, messages } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				port.postMessage({
					index: 1,
					key: "show-2",
					compact: false,
					edgeBack: true,
					leading: "back",
					type: "location",
					location: { search: "", kind: "entity", entityId: "show-2", entitySchemaSlug: "show" },
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(2)),
				);
				expect(
					ryotqlDocumentNodes(bindTestRequest(queryRequestsFor(messages, "summary")[1]?.request)),
				).toContain("show-2");
			}),
		testTimeout,
	);

	it.live(
		"renders pending status while the summary and overview queries are in flight",
		() =>
			Effect.gen(function* () {
				const { messages, container } = openShow();

				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "people")).toHaveLength(1)),
				);
				expect(container?.textContent).toContain("Loading details…");
			}),
		testTimeout,
	);

	it.live(
		"renders an error and retries through the query result",
		() =>
			Effect.gen(function* () {
				const { port, messages, container } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "failure",
					reason: "query-failed",
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(container?.textContent).toContain("Unable to load these details")),
				);

				const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
					(button) => button.textContent === "Try again",
				);
				if (retry === undefined) {
					throw new Error("Expected the Show retry button");
				}
				fireEvent.click(retry);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(2)),
				);
				reply(port, queryRequestFor(messages, "summary", 1).requestId, {
					outcome: "success",
					response: readyResponse,
				});

				yield* Effect.promise(() =>
					waitFor(() => expect(container?.textContent).toContain("Tracer Show")),
				);
			}),
		testTimeout,
	);

	it.live(
		"renders the missing state",
		() =>
			Effect.gen(function* () {
				const missing = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(missing.messages, "summary")).toHaveLength(1)),
				);
				reply(missing.port, queryRequestFor(missing.messages, "summary").requestId, {
					outcome: "success",
					response: { data: { summary: rows([]), requested: rows([]) } },
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(missing.container?.textContent).toContain("This entity no longer exists."),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"renders the wrong-schema state",
		() =>
			Effect.gen(function* () {
				const wrongSchema = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(wrongSchema.messages, "summary")).toHaveLength(1)),
				);
				reply(wrongSchema.port, queryRequestFor(wrongSchema.messages, "summary").requestId, {
					outcome: "success",
					response: { data: { summary: rows([]), requested: rows([{ schemaSlug: "movie" }]) } },
				});
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(wrongSchema.container?.textContent).toContain(
							"This entity is of a different type and cannot be opened here.",
						),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"renders seeded summary fields and publishes the Show title",
		() =>
			Effect.gen(function* () {
				const { port, messages, container } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "success",
					response: readyResponse,
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "people")).toHaveLength(1)),
				);
				replyOverview(port, messages);

				yield* Effect.promise(() =>
					waitFor(() => expect(container?.textContent).toContain("Tracer Show")),
				);
				expect(container?.textContent).toContain("TMDB");
				expect(container?.textContent).toContain("Drama");
				expect(container?.textContent).toContain("Returning Series");
				expect(container?.textContent).toContain("2 seasons");
				expect(container?.textContent).toContain("A deterministic show description.");
				expect(
					Array.from(container?.querySelectorAll("img") ?? []).map((image) =>
						image.getAttribute("src"),
					),
				).toEqual([
					"https://images.test/cover.jpg",
					"https://images.test/backdrop.jpg",
					"https://images.test/cover.jpg",
				]);
				expect(assetRequests(messages)).toHaveLength(0);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(messages).toContainEqual({
							index: 0,
							key: "show-1",
							type: "header",
							header: { title: "Tracer Show" },
						}),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"renders a managed cover placeholder before resolving its signed URL",
		() =>
			Effect.gen(function* () {
				const { port, messages, container } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "success",
					response: responseWithImages([
						{ type: "remote", purpose: "backdrop", url: "https://images.test/backdrop.jpg" },
						{ type: "local", purpose: "cover", key: "managed-cover" },
					]),
				});

				yield* Effect.promise(() => waitFor(() => expect(assetRequests(messages)).toHaveLength(1)));
				expect(assetRequestAt(messages, 0).assets).toEqual([
					{ type: "local", key: "managed-cover" },
				]);
				expect(managedCoverImage(container)).toBeUndefined();

				const signedUrl = "https://assets.test/managed-cover-v1?signature=one";
				const now = yield* DateTime.now;
				assetReply(port, assetRequestAt(messages, 0).requestId, {
					outcome: "success",
					resolutions: [
						{
							url: signedUrl,
							asset: { type: "local", key: "managed-cover" },
							expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: 10 })),
						},
					],
				});

				yield* Effect.promise(() =>
					waitFor(() => expect(managedCoverImage(container)?.getAttribute("src")).toBe(signedUrl)),
				);
			}),
		testTimeout,
	);

	it.live(
		"shows an unavailable managed cover after the initial asset request fails",
		() =>
			Effect.gen(function* () {
				const { port, messages, container } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "success",
					response: responseWithImages([{ type: "local", purpose: "cover", key: "managed-cover" }]),
				});
				yield* Effect.promise(() => waitFor(() => expect(assetRequests(messages)).toHaveLength(1)));

				assetReply(port, assetRequestAt(messages, 0).requestId, {
					outcome: "failure",
					reason: "asset-failed",
				});

				yield* Effect.promise(() => flush());
				expect(managedCoverImage(container)).toBeUndefined();
			}),
		testTimeout,
	);

	it.live(
		"refreshes one minute before expiry and keeps the stale URL after failure",
		() =>
			Effect.gen(function* () {
				const clock = openTestClock();
				const { port, messages, container } = openShow(clock);
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "success",
					response: responseWithImages([{ type: "local", purpose: "cover", key: "managed-cover" }]),
				});
				yield* Effect.promise(() => waitFor(() => expect(assetRequests(messages)).toHaveLength(1)));

				yield* Effect.promise(() =>
					clock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-09-04T12:00:00.000Z"))),
				);
				const expiresAt = DateTime.formatIso(DateTime.makeUnsafe("2026-09-04T12:05:00.000Z"));
				const staleUrl = "https://assets.test/managed-cover-v1?signature=stale";
				assetReply(port, assetRequestAt(messages, 0).requestId, {
					outcome: "success",
					resolutions: [
						{ expiresAt, url: staleUrl, asset: { type: "local", key: "managed-cover" } },
					],
				});
				yield* Effect.promise(() => flush());
				expect(managedCoverImage(container)?.getAttribute("src")).toBe(staleUrl);
				yield* Effect.promise(() => clock.advance(4 * 60000 - 1));
				expect(assetRequests(messages)).toHaveLength(1);
				yield* Effect.promise(() => clock.advance(1));
				yield* Effect.promise(() => flush());
				expect(assetRequests(messages)).toHaveLength(2);

				assetReply(port, assetRequestAt(messages, 1).requestId, {
					outcome: "failure",
					reason: "asset-failed",
				});
				yield* Effect.promise(() => flush());
				expect(managedCoverImage(container)?.getAttribute("src")).toBe(staleUrl);
			}),
		testTimeout,
	);

	it.live(
		"cancels a managed cover request when its screen unmounts",
		() =>
			Effect.gen(function* () {
				const { port, messages } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "success",
					response: responseWithImages([{ type: "local", purpose: "cover", key: "managed-cover" }]),
				});
				yield* Effect.promise(() => waitFor(() => expect(assetRequests(messages)).toHaveLength(1)));

				port.postMessage({
					index: 2,
					compact: false,
					edgeBack: false,
					leading: "none",
					type: "location",
					key: "replacement",
					location: { search: "", kind: "route", path: "/replacement" },
				});

				yield* Effect.promise(() => waitFor(() => expect(assetCancels(messages)).toHaveLength(1)));
				expect(assetCancels(messages)[0]).toEqual({
					type: "asset-cancel",
					requestId: assetRequestAt(messages, 0).requestId,
				});
			}),
		testTimeout,
	);

	it.live(
		"omits absent optional fields",
		() =>
			Effect.gen(function* () {
				const { port, messages, container } = openShow();
				yield* Effect.promise(() =>
					waitFor(() => expect(queryRequestsFor(messages, "summary")).toHaveLength(1)),
				);
				reply(port, queryRequestFor(messages, "summary").requestId, {
					outcome: "success",
					response: {
						data: {
							requested: rows([{ schemaSlug: "show" }]),
							summary: rows([
								{
									owned: false,
									id: "show-1",
									...artworkSummaryFixture([]),
									ownedEpisodes: 0,

									isCustom: false,
									airedEpisodes: 0,
									publishYear: null,
									description: null,
									publishDate: null,
									watchedEpisodes: 0,
									state: "untracked",
									totalSeasons: null,
									providerName: null,
									isMonitored: false,
									schemaSlug: "show",
									upcomingEpisodes: 0,
									name: "Sparse Show",
									totalEpisodes: null,
									providerRating: null,
									watchProviders: null,
									inProgressEpisodes: 0,
									originalLanguage: null,
									productionStatus: null,
									providerCheckedAt: null,
									isInMediaLibrary: false,
									populationStatus: { state: "idle", availability: "none" },
									translationStatus: { state: "idle", availability: "none" },
									nextUp: { items: [], pageInfo: { limit: 1, hasMore: false } },
									genres: { items: [], pageInfo: { limit: 100, hasMore: false } },
									collections: { items: [], pageInfo: { limit: 6, hasMore: false } },
									relatedPopulationStatus: { state: "succeeded", availability: "complete" },
								},
							]),
						},
					},
				});

				yield* Effect.promise(() =>
					waitFor(() => expect(container?.textContent).toContain("Sparse Show")),
				);
				expect(container?.textContent).not.toContain("Production status");
				expect(container?.textContent).not.toContain("season");
				expect(container?.querySelector("img")).toBeNull();
			}),
		testTimeout,
	);
});
