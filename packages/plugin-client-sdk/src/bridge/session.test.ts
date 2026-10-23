import { afterEach, describe, expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_MAX_PENDING_REQUESTS,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type ClientCompositionMetadata,
	type ClientPageContext,
	type PluginBridgeInit,
} from "@ryot-app/plugin-client-contract";
import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { createElement, Fragment } from "react";

import { RyotClientError } from "../client/errors";
import { createPluginNavigationStore } from "../navigation/store";
import { waitForMessagePortMacrotask } from "../testing";
import { createPluginRuntime } from "./session";

const metadata: ClientCompositionMetadata = {
	hash: "composition-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};
const init: PluginBridgeInit = {
	mode: "light",
	safeAreaTop: 0,
	safeAreaBottom: 0,
	documentKey: "page-1",
	sessionId: "session-id",
	compositionHash: metadata.hash,
	...metadata,
};
const document = { output: {}, queries: {} } as Parameters<
	ReturnType<typeof createPluginRuntime>["client"]["data"]["query"]
>[0]["document"];
const asset = { type: "local", key: "permanent/image.png" } as const;
const resolution = {
	asset,
	expiresAt: "2026-01-01T00:15:00.000Z",
	url: "https://ryot.test/api/uploads/local/download?key=permanent%2Fimage.png",
};
const channels: MessageChannel[] = [];
const runtimePage: ClientPageContext = {
	view: null,
	settings: {},
	dataSources: null,
	route: { params: {} },
	renderer: { kind: "plugin", exportName: "main", pluginId: "fixture" },
	target: {
		path: "/",
		search: "",
		kind: "plugin-route",
		packageId: PluginPackageId.make("test/fixture"),
	},
	contributors: [
		{
			kind: "plugin",
			contentHash: "source",
			revisionId: "revision",
			installationId: "installation",
			pluginId: PluginId.make("fixture"),
			packageId: PluginPackageId.make("test/fixture"),
		},
	],
};
const openRuntime = (page: ClientPageContext = runtimePage) =>
	Effect.gen(function* () {
		const channel = new MessageChannel();
		channels.push(channel);
		const messages: unknown[] = [];
		channel.port1.addEventListener("message", ({ data }) => messages.push(data));
		channel.port1.start();
		const navigation = createPluginNavigationStore(() => ({
			params: {},
			element: createElement(Fragment),
		}));
		const runtime = createPluginRuntime(
			channel.port2,
			{ ...init, page },
			metadata,
			{ setAttribute: () => {} },
			navigation,
			undefined,
			undefined,
			() => navigation.replaceDocument(() => ({ params: {}, element: createElement(Fragment) })),
		);
		channel.port1.postMessage({
			index: 0,
			key: "k0",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: { path: "/", search: "", kind: "route" },
		});
		yield* waitForMessagePortMacrotask;
		return { channel, runtime, messages };
	});
const query = (runtime: ReturnType<typeof createPluginRuntime>) =>
	runtime.client.data.query({
		document,
		decode: (response): Result.Result<unknown, RyotClientError> => Result.succeed(response),
	});
const providerSearch = (runtime: ReturnType<typeof createPluginRuntime>) =>
	runtime.client.screens.pickEntity({
		schema: { slug: "movie", owner: { kind: "plugin", pluginId: "fixture" } },
		library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
	});
const entitySave = (pluginId: string) => ({
	idempotencyKey: "form-1",
	submittedAt: "2026-10-19T00:00:00.000Z",
	submission: {
		name: "Item",
		properties: {},
		relationships: [],
		target: { kind: "create" as const },
		entitySchema: { slug: "item", owner: { pluginId, kind: "plugin" as const } },
	},
});
const sent = (messages: unknown[], type: string) =>
	messages.filter(
		(message) =>
			typeof message === "object" && message !== null && "type" in message && message.type === type,
	);

afterEach(() => {
	for (const channel of channels.splice(0)) {
		channel.port1.close();
		channel.port2.close();
	}
});

describe("plugin Effect request engine", () => {
	it.live("sends plugin preferences targets through the bridge for push and replace", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* openRuntime();
			const target = { packageId: "test/fixture", kind: "plugin-preferences" as const };
			runtime.client.navigation.push(target);
			runtime.client.navigation.replace(target);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "navigate")).toEqual([
				{ target, mode: "push", type: "navigate" },
				{ target, mode: "replace", type: "navigate" },
			]);
		}),
	);

	it.live("correlates device availability and preserves disposal failures", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const call = yield* Effect.forkChild(
				runtime.client.device({
					kind: "impact",
					action: "haptic",
					pluginId: PluginId.make("fixture"),
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "device-request")).toEqual([
				{
					kind: "impact",
					action: "haptic",
					pluginId: "fixture",
					requestId: "device-1",
					type: "device-request",
				},
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "device-result",
				requestId: "device-1",
				value: { status: "unsupported" },
			});
			expect(yield* Fiber.join(call)).toEqual({ status: "unsupported" });
			const disposed = yield* Effect.forkChild(
				Effect.result(
					runtime.client.device({
						kind: "impact",
						action: "haptic",
						pluginId: PluginId.make("fixture"),
					}),
				),
				{ startImmediately: true },
			);
			runtime.dispose();
			expect(yield* Fiber.join(disposed)).toMatchObject({
				_tag: "Failure",
				failure: { reason: "disposed" },
			});
		}),
	);

	it.live("correlates iOS live activity results and fails pending calls on disposal", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const request = { pluginId: PluginId.make("fixture") };
			const call = yield* Effect.forkChild(runtime.client.iosLiveActivities.availability(request), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ios-live-activity-request")).toEqual([
				{
					pluginId: "fixture",
					action: "availability",
					requestId: "ios-live-activity-1",
					type: "ios-live-activity-request",
				},
			]);
			channel.port1.postMessage({
				outcome: "success",
				value: { status: "available" },
				type: "ios-live-activity-result",
				requestId: "ios-live-activity-stale",
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				value: { status: "available" },
				requestId: "ios-live-activity-1",
				type: "ios-live-activity-result",
			});
			expect(yield* Fiber.join(call)).toEqual({ status: "available" });
			const failed = yield* Effect.forkChild(
				Effect.result(runtime.client.iosLiveActivities.list(request)),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				reason: "transport",
				requestId: "ios-live-activity-2",
				type: "ios-live-activity-result",
			});
			expect(yield* Fiber.join(failed)).toMatchObject({
				_tag: "Failure",
				failure: { reason: "transport" },
			});

			const disposed = yield* Effect.forkChild(
				Effect.result(runtime.client.iosLiveActivities.list(request)),
				{ startImmediately: true },
			);
			runtime.dispose();
			expect(yield* Fiber.join(disposed)).toMatchObject({
				_tag: "Failure",
				failure: { reason: "disposed" },
			});
		}),
	);

	it.live("correlates provider-search success and ignores stale results", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const pending = yield* Effect.forkChild(providerSearch(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "pick-entity-screen")).toEqual([
				{
					type: "pick-entity-screen",
					requestId: "pick-entity-screen-1",
					schema: { slug: "movie", owner: { kind: "plugin", pluginId: "fixture" } },
					library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
				},
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "pick-entity-screen-result",
				requestId: "pick-entity-screen-stale",
				value: { kind: "selected", entityIds: ["late-entity"] },
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				requestId: "pick-entity-screen-1",
				type: "pick-entity-screen-result",
				value: { kind: "selected", entityIds: ["entity-1"] },
			});
			expect(yield* Fiber.join(pending)).toEqual({ kind: "selected", entityIds: ["entity-1"] });
		}),
	);

	it.live("returns provider-search cancellation as a semantic outcome", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* openRuntime();
			const pending = yield* Effect.forkChild(providerSearch(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				value: { kind: "cancelled" },
				requestId: "pick-entity-screen-1",
				type: "pick-entity-screen-result",
			});
			expect(yield* Fiber.join(pending)).toEqual({ kind: "cancelled" });
		}),
	);

	it.live(
		"cancels interrupted provider-search requests and fails pending requests on disposal",
		() =>
			Effect.gen(function* () {
				const { runtime, messages } = yield* openRuntime();
				const interrupted = yield* Effect.forkChild(providerSearch(runtime), {
					startImmediately: true,
				});
				yield* waitForMessagePortMacrotask;
				yield* Fiber.interrupt(interrupted);
				yield* waitForMessagePortMacrotask;
				expect(sent(messages, "pick-entity-screen-cancel")).toEqual([
					{ requestId: "pick-entity-screen-1", type: "pick-entity-screen-cancel" },
				]);

				const pending = yield* Effect.forkChild(Effect.result(providerSearch(runtime)), {
					startImmediately: true,
				});
				yield* waitForMessagePortMacrotask;
				runtime.dispose();
				expect(yield* Fiber.join(pending)).toMatchObject({ failure: { reason: "disposed" } });
			}),
	);

	it.live("sends calendar source visibility changes and hints a refresh only on success", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const hints: null[] = [];
			runtime.client.mutationCompleted.subscribe(() => hints.push(null));
			const hide = yield* Effect.forkChild(
				runtime.client.calendarSources.setVisibility({
					isHidden: true,
					slug: "reminders",
					pluginId: "fixture",
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "calendar-source-visibility-request")).toEqual([
				{
					isHidden: true,
					slug: "reminders",
					pluginId: "fixture",
					requestId: "calendar-source-visibility-1",
					type: "calendar-source-visibility-request",
				},
			]);
			channel.port1.postMessage({
				outcome: "success",
				requestId: "calendar-source-visibility-1",
				type: "calendar-source-visibility-result",
			});
			yield* Fiber.join(hide);
			expect(hints).toHaveLength(1);

			const show = yield* Effect.forkChild(
				runtime.client.calendarSources.setVisibility({
					isHidden: false,
					slug: "reminders",
					pluginId: "fixture",
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				reason: "invalid-request",
				requestId: "calendar-source-visibility-2",
				type: "calendar-source-visibility-result",
			});
			expect(yield* Effect.flip(Fiber.join(show))).toMatchObject({ reason: "invalid-request" });
			expect(hints).toHaveLength(1);
		}),
	);

	it.live("correlates collection screen outcomes and ignores stale or mistyped results", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const edit = yield* Effect.forkChild(
				runtime.client.screens.editCollection({ collectionId: "collection-1" }),
				{ startImmediately: true },
			);
			const add = yield* Effect.forkChild(
				runtime.client.screens.addToCollection({ entityId: "entity-1" }),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "edit-collection-screen")).toEqual([
				{
					collectionId: "collection-1",
					type: "edit-collection-screen",
					requestId: "edit-collection-screen-1",
				},
			]);
			expect(sent(messages, "add-to-collection-screen")).toEqual([
				{
					entityId: "entity-1",
					type: "add-to-collection-screen",
					requestId: "add-to-collection-screen-2",
				},
			]);
			channel.port1.postMessage({
				outcome: "success",
				value: { kind: "removed" },
				requestId: "edit-collection-screen-1",
				type: "add-to-collection-screen-result",
			});
			channel.port1.postMessage({
				outcome: "success",
				value: { kind: "deleted" },
				type: "edit-collection-screen-result",
				requestId: "edit-collection-screen-stale",
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				value: { kind: "deleted" },
				requestId: "edit-collection-screen-1",
				type: "edit-collection-screen-result",
			});
			channel.port1.postMessage({
				outcome: "failure",
				reason: "collection-failed",
				requestId: "add-to-collection-screen-2",
				type: "add-to-collection-screen-result",
			});
			expect(yield* Fiber.join(edit)).toEqual({ kind: "deleted" });
			expect(yield* Effect.flip(Fiber.join(add))).toMatchObject({ reason: "collection-failed" });
		}),
	);

	it.live("cancels interrupted collection screens and rejects them on document change", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const edit = yield* Effect.forkChild(runtime.client.screens.editCollection({}), {
				startImmediately: true,
			});
			const add = yield* Effect.forkChild(
				runtime.client.screens.addToCollection({ entityId: "entity-1" }),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			yield* Fiber.interrupt(edit);
			yield* Fiber.interrupt(add);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "edit-collection-screen-cancel")).toEqual([
				{ requestId: "edit-collection-screen-1", type: "edit-collection-screen-cancel" },
			]);
			expect(sent(messages, "add-to-collection-screen-cancel")).toEqual([
				{ requestId: "add-to-collection-screen-2", type: "add-to-collection-screen-cancel" },
			]);

			const pending = yield* Effect.forkChild(
				Effect.result(runtime.client.screens.addToCollection({ entityId: "entity-1" })),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				type: "document",
				page: runtimePage,
				documentKey: "page-2",
				navigation: {
					index: 1,
					key: "k1",
					compact: false,
					edgeBack: false,
					type: "location",
					leading: "drawer",
					location: { path: "/", search: "", kind: "route" },
				},
			});
			expect(yield* Fiber.join(pending)).toMatchObject({ failure: { reason: "disposed" } });
			channel.port1.postMessage({
				outcome: "success",
				value: { kind: "saved" },
				requestId: "add-to-collection-screen-3",
				type: "add-to-collection-screen-result",
			});
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "lifecycle-close")).toEqual([]);

			const disposed = yield* Effect.forkChild(
				Effect.result(runtime.client.screens.editCollection({})),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			runtime.dispose();
			expect(yield* Fiber.join(disposed)).toMatchObject({ failure: { reason: "disposed" } });
		}),
	);

	it.live("acknowledges a flush only after registered persistence completes", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const waitForFlush = (requestId: string) =>
				Effect.callback<boolean>((resume) => {
					const receive = ({ data }: MessageEvent<unknown>) => {
						if (
							typeof data === "object" &&
							data !== null &&
							"type" in data &&
							data.type === "flush-result" &&
							"requestId" in data &&
							data.requestId === requestId &&
							"flushed" in data &&
							typeof data.flushed === "boolean"
						) {
							resume(Effect.succeed(data.flushed));
						}
					};
					channel.port1.addEventListener("message", receive);
					return Effect.sync(() => channel.port1.removeEventListener("message", receive));
				});
			const gate = yield* Deferred.make<void, RyotClientError>();
			const remove = runtime.client.persistence.registerFlush(() => Deferred.await(gate));
			const first = yield* Effect.forkChild(waitForFlush("leave-1"), { startImmediately: true });
			channel.port1.postMessage({ requestId: "leave-1", type: "flush-request" });
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "flush-result")).toEqual([]);
			yield* Deferred.fail(gate, new RyotClientError("quota"));
			expect(yield* Fiber.join(first)).toBe(false);
			expect(sent(messages, "flush-result")).toEqual([
				{ flushed: false, type: "flush-result", requestId: "leave-1" },
			]);
			remove();
			const second = yield* Effect.forkChild(waitForFlush("leave-2"), { startImmediately: true });
			channel.port1.postMessage({ requestId: "leave-2", type: "flush-request" });
			expect(yield* Fiber.join(second)).toBe(true);
			expect(sent(messages, "flush-result")).toContainEqual({
				flushed: true,
				type: "flush-result",
				requestId: "leave-2",
			});
		}),
	);
	it.live("binds only the exact prepared contributors and rejects foreign storage ownership", () =>
		Effect.gen(function* () {
			const packageId = PluginPackageId.make("test/fixture");
			const otherPackageId = PluginPackageId.make("test/other");
			const pluginId = PluginId.make("private-owner");
			const page: ClientPageContext = {
				view: null,
				settings: {},
				dataSources: null,
				route: { params: {} },
				renderer: { pluginId, kind: "plugin", exportName: "main" },
				target: { packageId, path: "/", search: "", kind: "plugin-route" },
				contributors: [
					{
						pluginId,
						packageId,
						kind: "plugin",
						contentHash: "source",
						revisionId: "revision",
						installationId: "installation",
					},
				],
			};
			const { runtime, messages } = yield* openRuntime(page);
			expect(runtime.client.pluginIdentity(packageId)).toEqual({ pluginId, kind: "local" });
			expect(() => runtime.client.pluginIdentity(otherPackageId)).toThrow(RyotClientError);
			expect(
				(yield* Effect.flip(runtime.client.storage.get(PluginId.make("foreign-owner"), "key")))
					.reason,
			).toBe("invalid-request");
			expect(sent(messages, "storage-request")).toEqual([]);
			runtime.dispose();
			expect(() => runtime.client.pluginIdentity(packageId)).toThrow(RyotClientError);
		}),
	);
	it.live(
		"correlates external links and clears interrupted and disposed calls without cancellation",
		() =>
			Effect.gen(function* () {
				const { channel, runtime, messages } = yield* openRuntime();
				const first = yield* Effect.forkChild(
					runtime.client.links.open({ url: "https://example.test" }),
					{ startImmediately: true },
				);
				yield* waitForMessagePortMacrotask;
				expect(sent(messages, "external-link-request")).toEqual([
					{
						url: "https://example.test",
						requestId: "external-link-1",
						type: "external-link-request",
					},
				]);
				channel.port1.postMessage({
					outcome: "success",
					requestId: "external-link-1",
					type: "external-link-result",
				});
				expect(yield* Fiber.join(first)).toEqual({ outcome: "success" });
				const interrupted = yield* Effect.forkChild(
					runtime.client.links.open({ url: "http://example.test" }),
					{ startImmediately: true },
				);
				yield* Fiber.interrupt(interrupted);
				channel.port1.postMessage({
					outcome: "success",
					requestId: "external-link-2",
					type: "external-link-result",
				});
				const failure = yield* Effect.forkChild(
					Effect.result(runtime.client.links.open({ url: "https://example.test" })),
					{ startImmediately: true },
				);
				channel.port1.postMessage({
					outcome: "failure",
					requestId: "external-link-3",
					type: "external-link-result",
					reason: "activation-required",
				});
				expect(yield* Fiber.join(failure)).toMatchObject({
					failure: { reason: "activation-required" },
				});
				const disposed = yield* Effect.forkChild(
					Effect.result(runtime.client.links.open({ url: "https://example.test" })),
					{ startImmediately: true },
				);
				runtime.dispose();
				expect(yield* Fiber.join(disposed)).toMatchObject({ failure: { reason: "disposed" } });
				channel.port1.postMessage({
					outcome: "success",
					requestId: "external-link-4",
					type: "external-link-result",
				});
				yield* waitForMessagePortMacrotask;
				expect(sent(messages, "external-link-cancel")).toEqual([]);
			}),
	);
	it.live("reports embedded metadata and correlates successful and failed queries", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			expect(messages[0]).toEqual({
				format: metadata.format,
				sessionId: init.sessionId,
				compositionHash: metadata.hash,
				apiVersion: metadata.apiVersion,
				bridgeVersion: metadata.bridgeVersion,
				compilerVersion: metadata.compilerVersion,
			});
			const first = yield* Effect.forkChild(query(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ryotql-request")).toContainEqual({
				document,
				requestId: "ryotql-1",
				type: "ryotql-request",
			});
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-1",
				response: { data: {} },
			});
			expect(yield* Fiber.join(first)).toEqual({ data: {} });
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ryotql-cancel")).toEqual([]);
			const second = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				type: "ryotql-result",
				requestId: "ryotql-2",
				reason: "query-failed",
			});
			expect(yield* Fiber.join(second)).toMatchObject({ failure: { reason: "query-failed" } });
		}),
	);

	it.live("cancels an interrupted query exactly once and ignores its late result", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const fiber = yield* Effect.forkChild(query(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
			yield* Fiber.interrupt(fiber);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ryotql-cancel")).toEqual([
				{ requestId: "ryotql-1", type: "ryotql-cancel" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-1",
				response: { data: {} },
			});
			const next = yield* Effect.forkChild(query(runtime), { startImmediately: true });
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "ryotql-request")).toContainEqual({
				document,
				requestId: "ryotql-2",
				type: "ryotql-request",
			});
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-2",
				response: { data: {} },
			});
			expect(yield* Fiber.join(next)).toEqual({ data: {} });
		}),
	);

	it.live("cancels interrupted asset resolution and retains its correlation", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const fiber = yield* Effect.forkChild(runtime.client.assets.resolve([asset]), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			yield* Fiber.interrupt(fiber);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "asset-cancel")).toEqual([
				{ requestId: "asset-1", type: "asset-cancel" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				type: "asset-result",
				requestId: "asset-1",
				resolutions: [resolution],
			});
			const next = yield* Effect.forkChild(runtime.client.assets.resolve([asset]), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				type: "asset-result",
				requestId: "asset-2",
				resolutions: [resolution],
			});
			expect(yield* Fiber.join(next)).toEqual([resolution]);
		}),
	);

	it.live("does not introduce a cancel wire message for operations, storage, or uploads", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* openRuntime();
			const operation = yield* Effect.forkChild(
				runtime.client.operations.invoke({
					input: {},
					slug: "greet",
					output: Schema.String,
					packageId: "test/fixture",
					inputSchema: Schema.Struct({}),
				}),
				{ startImmediately: true },
			);
			const storage = yield* Effect.forkChild(
				runtime.client.storage.get(PluginId.make("fixture"), "key"),
				{ startImmediately: true },
			);
			const upload = yield* Effect.forkChild(
				runtime.client.uploads.uploadTemporary({
					fileName: "data.txt",
					contentType: "text/plain",
					source: new Blob(["data"]),
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			yield* Effect.forEach([operation, storage, upload], Fiber.interrupt);
			expect(sent(messages, "operation-request")).toHaveLength(1);
			expect(sent(messages, "storage-request")).toHaveLength(1);
			expect(sent(messages, "upload-request")).toHaveLength(1);
			expect(sent(messages, "operation-cancel")).toHaveLength(0);
			expect(sent(messages, "storage-cancel")).toHaveLength(0);
			expect(sent(messages, "upload-cancel")).toHaveLength(0);
		}),
	);

	it.live("sends temporary, permanent, and cleanup uploads and accepts storage results", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const source = new Blob(["id,title"], { type: "text/csv" });
			const upload = yield* Effect.forkChild(
				runtime.client.uploads.uploadTemporary({
					source,
					fileName: "items.csv",
					contentType: "text/csv",
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			const request = sent(messages, "upload-request")[0];
			expect(request).toMatchObject({
				action: "temporary",
				requestId: "upload-1",
				fileName: "items.csv",
				contentType: "text/csv",
			});
			const uploadSource =
				request && typeof request === "object" && "source" in request ? request.source : undefined;
			if (!(uploadSource instanceof Blob)) {
				throw new Error("Expected Blob upload");
			}
			expect(yield* Effect.promise(() => uploadSource.text())).toBe("id,title");
			channel.port1.postMessage({
				outcome: "success",
				action: "temporary",
				type: "upload-result",
				requestId: "upload-1",
				token: { token: "upload-token", expiresAt: "2026-01-01T00:15:00.000Z" },
			});
			expect(yield* Fiber.join(upload)).toMatchObject({ token: "upload-token" });
			const permanentUpload = yield* Effect.forkChild(
				runtime.client.uploads.uploadPermanent({
					source,
					fileName: "items.csv",
					contentType: "text/csv",
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "upload-request")[1]).toMatchObject({
				source,
				action: "permanent",
				requestId: "upload-2",
			});
			channel.port1.postMessage({
				asset,
				outcome: "success",
				action: "permanent",
				type: "upload-result",
				requestId: "upload-2",
			});
			expect(yield* Fiber.join(permanentUpload)).toEqual(asset);
			const cleanup = yield* Effect.forkChild(runtime.client.uploads.cleanup(asset), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "upload-request")[2]).toEqual({
				asset,
				action: "cleanup",
				requestId: "upload-3",
				type: "upload-request",
			});
			channel.port1.postMessage({
				action: "cleanup",
				outcome: "success",
				status: "referenced",
				type: "upload-result",
				requestId: "upload-3",
			});
			expect(yield* Fiber.join(cleanup)).toEqual({ status: "referenced" });
			const storage = yield* Effect.forkChild(
				Effect.result(runtime.client.storage.get(PluginId.make("fixture"), "key")),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				reason: "quota",
				outcome: "failure",
				type: "storage-result",
				requestId: "storage-4",
			});
			expect(yield* Fiber.join(storage)).toMatchObject({ failure: { reason: "quota" } });
		}),
	);

	it.live("retries population for the package's own plugin and refreshes after the result", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			let refreshes = 0;
			runtime.client.mutationCompleted.subscribe(() => {
				refreshes++;
			});
			expect(
				(yield* Effect.flip(
					runtime.client.entities.retryPopulation({
						entityId: "entity-1",
						packageId: PluginPackageId.make("test/foreign"),
					}),
				)).reason,
			).toBe("invalid-request");
			expect(sent(messages, "retry-population-request")).toEqual([]);

			const retried = yield* Effect.forkChild(
				runtime.client.entities.retryPopulation({
					entityId: "entity-1",
					packageId: PluginPackageId.make("test/fixture"),
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "retry-population-request")).toEqual([
				{
					pluginId: "fixture",
					entityId: "entity-1",
					requestId: "retry-population-1",
					type: "retry-population-request",
				},
			]);
			channel.port1.postMessage({
				retried: true,
				outcome: "success",
				type: "retry-population-result",
				requestId: "retry-population-1",
			});
			expect(yield* Fiber.join(retried)).toEqual({ retried: true });
			expect(refreshes).toBe(1);

			const refused = yield* Effect.forkChild(
				Effect.flip(
					runtime.client.entities.retryPopulation({
						entityId: "entity-1",
						packageId: PluginPackageId.make("test/fixture"),
					}),
				),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				reason: "invalid-request",
				type: "retry-population-result",
				requestId: "retry-population-2",
			});
			expect((yield* Fiber.join(refused)).reason).toBe("invalid-request");
			expect(refreshes).toBe(1);
		}),
	);

	it.live("reads user settings only for contributing plugins and decodes the record", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			expect(
				(yield* Effect.flip(runtime.client.userSettings(PluginId.make("foreign-owner")))).reason,
			).toBe("invalid-request");
			expect(sent(messages, "user-settings-request")).toEqual([]);

			const read = yield* Effect.forkChild(runtime.client.userSettings(PluginId.make("fixture")), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "user-settings-request")).toEqual([
				{ pluginId: "fixture", requestId: "user-settings-1", type: "user-settings-request" },
			]);
			channel.port1.postMessage({
				outcome: "success",
				settings: { limit: 3 },
				type: "user-settings-result",
				requestId: "user-settings-1",
			});
			expect(yield* Fiber.join(read)).toEqual({ limit: 3 });

			const refused = yield* Effect.forkChild(
				Effect.flip(runtime.client.userSettings(PluginId.make("fixture"))),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				reason: "invalid-request",
				type: "user-settings-result",
				requestId: "user-settings-2",
			});
			expect((yield* Fiber.join(refused)).reason).toBe("invalid-request");
		}),
	);

	it.live("sends entity saves only for contributing owners and settles their output", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			const refreshes: number[] = [];
			runtime.client.mutationCompleted.subscribe(() => refreshes.push(1));
			expect(
				(yield* Effect.flip(runtime.client.entities.save(entitySave("foreign-owner")))).reason,
			).toBe("invalid-request");
			expect(sent(messages, "entity-editor-save-request")).toEqual([]);

			const save = yield* Effect.forkChild(runtime.client.entities.save(entitySave("fixture")), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			const [sentRequest] = sent(messages, "entity-editor-save-request");
			expect(sentRequest).toEqual({
				...entitySave("fixture"),
				requestId: "entity-editor-save-1",
				type: "entity-editor-save-request",
			});
			channel.port1.postMessage({
				outcome: "success",
				requestId: "entity-editor-save-1",
				type: "entity-editor-save-result",
				output: { kind: "saved", entityId: "entity-1" },
			});
			expect(yield* Fiber.join(save)).toEqual({ kind: "saved", entityId: "entity-1" });
			expect(refreshes).toHaveLength(1);

			const refused = yield* Effect.forkChild(
				Effect.result(runtime.client.entities.save(entitySave("fixture"))),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "failure",
				reason: "entity-save-failed",
				requestId: "entity-editor-save-2",
				type: "entity-editor-save-result",
			});
			expect(yield* Fiber.join(refused)).toMatchObject({
				failure: { reason: "entity-save-failed" },
			});
		}),
	);

	it.live("fails all pending requests on replacement and disposal, ignoring late responses", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* openRuntime();
			const pending = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				type: "document",
				documentKey: "page-2",
				navigation: {
					index: 1,
					key: "k1",
					compact: false,
					edgeBack: false,
					leading: "none",
					type: "location",
					location: { search: "", path: "/new", kind: "route" },
				},
			});
			expect(yield* Fiber.join(pending)).toMatchObject({ failure: { reason: "disposed" } });
			const next = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			yield* waitForMessagePortMacrotask;
			runtime.dispose();
			channel.port1.postMessage({
				outcome: "success",
				type: "ryotql-result",
				requestId: "ryotql-2",
				response: { data: {} },
			});
			expect(yield* Fiber.join(next)).toMatchObject({ failure: { reason: "disposed" } });
			expect(yield* Effect.result(query(runtime))).toMatchObject({
				failure: { reason: "disposed" },
			});
		}),
	);

	it.live("fails the session at the aggregate pending limit", () =>
		Effect.gen(function* () {
			const { runtime, messages } = yield* openRuntime();
			const fibers = yield* Effect.forEach(
				Array.from({ length: CLIENT_BRIDGE_MAX_PENDING_REQUESTS }),
				() => Effect.forkChild(Effect.result(query(runtime)), { startImmediately: true }),
			);
			const overflow = yield* Effect.forkChild(Effect.result(query(runtime)), {
				startImmediately: true,
			});
			expect(yield* Fiber.join(overflow)).toMatchObject({ failure: { reason: "protocol" } });
			const results = yield* Effect.forEach(fibers, Fiber.join);
			yield* waitForMessagePortMacrotask;
			expect(results).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(sent(messages, "ryotql-request")).toHaveLength(CLIENT_BRIDGE_MAX_PENDING_REQUESTS);
			expect(sent(messages, "lifecycle-close")).toEqual([
				{ reason: "failed", type: "lifecycle-close" },
			]);
		}),
	);

	it.live("classifies malformed host results as protocol failures", () =>
		Effect.gen(function* () {
			const { channel, runtime } = yield* openRuntime();
			const pending = yield* Effect.forkChild(
				Effect.result(
					runtime.client.operations.invoke({
						input: null,
						slug: "greet",
						output: Schema.String,
						inputSchema: Schema.Null,
						packageId: "test/fixture",
					}),
				),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			channel.port1.postMessage({
				outcome: "success",
				type: "operation-result",
				requestId: "operation-1",
				value: { invalid: undefined },
			});
			expect(yield* Fiber.join(pending)).toMatchObject({
				failure: new RyotClientError("protocol"),
			});
		}),
	);

	it.live("dispatches operation and collection results with semantic mutation hints", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			let hints = 0;
			runtime.client.mutationCompleted.subscribe(() => hints++);
			const operation = yield* Effect.forkChild(
				runtime.client.operations.invoke({
					input: {},
					slug: "greet",
					output: Schema.String,
					packageId: "test/fixture",
					idempotencyKey: "submission-1",
					inputSchema: Schema.Struct({}),
				}),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "operation-request")).toEqual([
				{
					input: {},
					operationSlug: "greet",
					requestId: "operation-1",
					packageId: "test/fixture",
					type: "operation-request",
					idempotencyKey: "submission-1",
				},
			]);
			channel.port1.postMessage({
				value: "hello",
				outcome: "success",
				type: "operation-result",
				requestId: "operation-1",
			});
			expect(yield* Fiber.join(operation)).toBe("hello");
			const membership = yield* Effect.forkChild(
				Effect.result(
					runtime.client.collections.removeMembership({
						entityId: "entity-1",
						collectionId: "collection-1",
					}),
				),
				{ startImmediately: true },
			);
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "collection-request")).toContainEqual({
				requestId: "collection-2",
				type: "collection-request",
				action: "remove-membership",
				input: { entityId: "entity-1", collectionId: "collection-1" },
			});
			channel.port1.postMessage({
				outcome: "failure",
				type: "collection-result",
				requestId: "collection-2",
				reason: "collection-failed",
			});
			expect(yield* Fiber.join(membership)).toMatchObject({
				failure: { reason: "collection-failed" },
			});
			expect(hints).toBe(1);
		}),
	);

	it.live("keeps theme, page refresh, and entity-watches subscriptions synchronous", () =>
		Effect.gen(function* () {
			const { channel, runtime, messages } = yield* openRuntime();
			let themes = 0;
			let hints = 0;
			const updates: unknown[] = [];
			const unsubscribe = runtime.client.theme.subscribe(() => themes++);
			runtime.client.mutationCompleted.subscribe(() => hints++);
			const subscription = runtime.client.entities.watch(
				{ visible: [], foreground: ["entity-1"] },
				(update) => updates.push(update),
			);
			channel.port1.postMessage({ mode: "dark", type: "theme" });
			channel.port1.postMessage({ type: "page-refresh" });
			channel.port1.postMessage({
				entityId: "entity-1",
				reason: "translated",
				type: "entity-updated",
			});
			yield* waitForMessagePortMacrotask;
			expect(runtime.client.theme.getSnapshot()).toEqual({ resolvedMode: "dark" });
			expect(themes).toBe(1);
			expect(hints).toBe(1);
			expect(updates).toEqual([{ entityId: "entity-1", reason: "translated" }]);
			expect(sent(messages, "entity-watches")).toContainEqual({
				visible: [],
				type: "entity-watches",
				foreground: ["entity-1"],
			});
			subscription.dispose();
			unsubscribe();
			yield* waitForMessagePortMacrotask;
			expect(sent(messages, "entity-watches").at(-1)).toEqual({
				visible: [],
				foreground: [],
				type: "entity-watches",
			});
		}),
	);
});
