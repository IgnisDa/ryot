// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeInit,
	PluginBridgeLocation,
} from "@ryot-app/client-plugin-contract";
import {
	ClientPagePreparationError,
	type ClientPageTarget,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/client-pages/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginSlug,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import { ClientPagesApi } from "#/api/client-pages";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { ClientPageFreshness } from "#/modules/client-pages/freshness";
import { EntitiesService } from "#/modules/entities/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import type { ProviderAddService } from "#/modules/provider-add/service";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	CustomizeRouteStubs,
	GodModeRouteStubs,
	ImportsRouteStubs,
	IntegrationRouteStubs,
	NavigationRouteStubs,
	NotificationChannelRouteStubs,
	OAuthRouteStubs,
	ProviderAddRouteStubs,
	SavedViewRouteStubs,
	ServerStub,
	catalog,
	makeAuthStub,
	makeProviderAddStub,
	makePublicApiStub,
	makeStorageStub,
	theme,
} from "#/routes/-route-fixtures";

const preparedFor = (
	target: Exclude<ClientPageTarget, { readonly kind: "saved-view" }>,
	pluginId = "plugin-1",
): PreparedClientPage => {
	const entityTarget =
		target.kind === "entity"
			? {
					...target,
					entitySchemaPluginId: pluginId,
					entitySchemaSlug: EntitySchemaSlug.make("book"),
				}
			: target;
	return {
		context: {
			view: null,
			settings: {},
			dataSources: null,
			target: entityTarget,
			route: { params: {} },
			renderer: { pluginId, kind: "plugin", exportName: "page" },
		},
		artifact: {
			hash: `artifact-${pluginId}`,
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
			grant: {
				grantId: `grant-${pluginId}`,
				expiresAt: "2030-01-01T00:00:00.000Z",
				src: `https://artifacts.example/artifact-${pluginId}/index.html`,
			},
		},
		identity: {
			target,
			pluginId,
			exportName: "page",
			kind: "plugin-page",
			sourceHash: `source-${pluginId}`,
			artifactHash: `artifact-${pluginId}`,
			artifactKey: `artifact-key-${pluginId}`,
			installationId: `installation-${pluginId}`,
			contributors: [
				{
					pluginId,
					kind: "plugin",
					sourceHash: `source-${pluginId}`,
					installationId: `installation-${pluginId}`,
					pluginSlug: PluginSlug.make(pluginId === "plugin-1" ? "fixture" : "journal"),
				},
			],
			operationTargets: [
				{
					pluginId,
					sourceHash: `source-${pluginId}`,
					installationId: `installation-${pluginId}`,
					pluginSlug: PluginSlug.make(pluginId === "plugin-1" ? "fixture" : "journal"),
				},
				{
					pluginId: "operations-only-id",
					sourceHash: "operations-only-source",
					installationId: "operations-only-installation",
					pluginSlug: PluginSlug.make("operations-only"),
				},
			],
		},
	};
};

const preparedSavedView = (savedViewId: SavedViewId): PreparedClientPage => {
	const prepared = preparedFor({
		path: "/",
		search: "",
		kind: "plugin-route",
		pluginSlug: PluginSlug.make("fixture"),
	});
	return {
		...prepared,
		context: {
			...prepared.context,
			view: { icon: "list", name: "Fixture View" },
			renderer: { kind: "kernel", name: "dashboard" },
			target: { slug: savedViewId, kind: "saved-view" },
		},
		identity: {
			savedViewId,
			viewRevision: 1,
			kind: "kernel-saved-view",
			rendererName: "dashboard",
			sourceHash: "source-plugin-1",
			artifactKey: prepared.identity.artifactKey,
			artifactHash: prepared.identity.artifactHash,
			contributors: prepared.identity.contributors,
			target: { slug: savedViewId, kind: "saved-view" },
			operationTargets: prepared.identity.operationTargets,
		},
	};
};

function mount(options: {
	readonly entry: string;
	readonly entries?: PluginClientCatalog;
	readonly auth?: ReturnType<typeof makeAuthStub>;
	readonly storage?: ClientStorage["Service"];
	readonly loadProviders?: ProviderAddService["Service"]["loadProviders"];
	readonly prepare?: ClientPagesApi["Service"]["prepare"];
	readonly check?: ClientPageFreshness["Service"]["check"];
}) {
	const targets: ClientPageTarget[] = [];
	const operations: Parameters<PluginOperationsService["Service"]["invoke"]>[0][] = [];
	let catalogLoads = 0;
	const entries = options.entries ?? catalog;
	const prepare: ClientPagesApi["Service"]["prepare"] =
		options.prepare ??
		((_scope, request) => {
			targets.push(request.payload.target);
			const target = request.payload.target;
			if (target.kind === "saved-view") {
				return Effect.succeed(preparedSavedView(SavedViewId.make(target.slug)));
			}
			const pluginId =
				target.kind === "plugin-route"
					? (entries.find((entry) => entry.slug === target.pluginSlug)?.pluginId ?? "plugin-1")
					: "plugin-1";
			return Effect.succeed(preparedFor(target, pluginId));
		});
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			options.loadProviders
				? makeProviderAddStub({ loadProviders: options.loadProviders })
				: ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			options.auth ?? makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			Layer.succeed(EntitiesService, { loadRouteProvenance: () => Effect.die("not used") }),
			makePublicApiStub(),
			KernelApiTestLayer,
			events.layer,
			Layer.succeed(PluginCatalogService, {
				load: () =>
					Effect.sync(() => {
						catalogLoads += 1;
						return entries;
					}),
			}),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(ClientPagesApi, {
				prepare,
				checkFreshness: () => Effect.succeed({ current: true }),
			}),
			Layer.succeed(ClientPageFreshness, { check: options.check ?? (() => Effect.succeed(true)) }),
			Layer.succeed(PluginOperationsService, {
				invoke: (input) => {
					operations.push(input);
					return Effect.succeed({ value: null, outcome: "success" });
				},
			}),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(
				Layer.succeed(ClientStorage, options.storage ?? makeStorageStub("fixture")),
			),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [options.entry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, events, router, targets, operations, getCatalogLoads: () => catalogLoads };
}

function connectFrame(frame: HTMLIFrameElement) {
	const messages: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let port: MessagePort | undefined;
	Object.defineProperty(frame, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (message: unknown, _origin: string, transfer: Transferable[]) => {
				init = Schema.decodeUnknownSync(PluginBridgeInit)(message);
				const transferred = transfer[0];
				if (!(transferred instanceof MessagePort)) {
					throw new Error("Missing plugin port");
				}
				port = transferred;
				port.addEventListener("message", (event) => messages.push(event.data));
				port.start();
			},
		},
	});
	fireEvent.load(frame);
	if (init === undefined || port === undefined) {
		throw new Error("Bridge did not connect");
	}
	const {
		mode: _mode,
		page: _page,
		safeAreaTop: _top,
		safeAreaBottom: _bottom,
		documentKey: _documentKey,
		...ready
	} = init;
	port.postMessage(ready);
	return { init, port, messages };
}

const preparationFailure = (reason: ClientPagePreparationError["reason"]) =>
	Effect.fail(new AuthenticatedApiError({ cause: new ClientPagePreparationError({ reason }) }));

describe("client page routes", () => {
	it("prepares a saved-view slug without loading a saved-view record", async () => {
		const view = mount({ entry: "/v/fixture-view" });
		await waitFor(() =>
			expect(view.targets).toEqual([{ kind: "saved-view", slug: "fixture-view" }]),
		);
	});

	it("uses prepared saved-view metadata and the route slug for local layout", async () => {
		const layoutKeys: string[] = [];
		const storage = makeStorageStub("fixture");
		const view = mount({
			entry: "/v/fixture-view",
			loadProviders: () =>
				Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } }),
			storage: {
				...storage,
				getSavedViewLayout: (_scope, slug) =>
					Effect.sync(() => {
						layoutKeys.push(slug);
						return "grid" as const;
					}),
			},
			prepare: (_scope, request) => {
				const target = request.payload.target;
				if (target.kind !== "saved-view") {
					return Effect.die("not used");
				}
				const prepared = preparedSavedView(SavedViewId.make("internal-id"));
				return Effect.succeed({
					...prepared,
					context: {
						...prepared.context,
						target,
						renderer: { kind: "kernel", name: "Entity browser" },
						settings: {
							pageSize: 20,
							sortChoices: [],
							searchFields: [],
							tableColumns: null,
							entityIdField: "id",
							sourceName: "items",
							defaultLayout: "list",
							layouts: ["grid", "list"],
							ownerPluginIdField: "owner",
							entitySchemaSlugField: "schema",
							addAction: {
								type: "provider-search",
								entitySchemaSlug: "book",
								ownerPluginId: "plugin-1",
							},
						},
					},
				});
			},
		});
		const frame = await screen.findByTitle<HTMLIFrameElement>("Fixture View plugin");
		const bridge = connectFrame(frame);
		expect(layoutKeys).toEqual(["fixture-view"]);
		expect(bridge.init.page?.settings).toMatchObject({ defaultLayout: "grid" });
		expect(view.router.state.location.pathname).toBe("/v/fixture-view");
		bridge.port.postMessage({
			entitySchemaSlug: "book",
			ownerPluginId: "plugin-1",
			type: "provider-search-screen",
		});
		await waitFor(() => expect(view.router.state.location.searchStr).toBe("?add=true"));
		await screen.findByRole("dialog", { name: "Add from a provider" });
	});

	it("uses the hydrated parent catalog on plugin navigation", async () => {
		const view = mount({ entry: "/fixture" });
		await screen.findByTitle("fixture plugin");
		expect(view.getCatalogLoads()).toBe(1);
		await view.router.navigate({ href: "/fixture/details/one" });
		await waitFor(() =>
			expect(view.targets.at(-1)).toEqual({
				search: "",
				path: "/details/one",
				kind: "plugin-route",
				pluginSlug: "fixture",
			}),
		);
		expect(view.getCatalogLoads()).toBe(1);
	});

	it("renders the selected home view at the active workspace URL through one page host", async () => {
		const savedViewId = SavedViewId.make("home-view-1");
		const view = mount({
			entry: "/fixture",
			entries: [{ ...catalog[0], homeSavedViewId: savedViewId }],
		});
		const frame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const bridge = connectFrame(frame);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		expect(view.targets).toEqual([
			{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
		]);
		expect(view.router.state.location.pathname).toBe("/fixture");
		expect(screen.getByRole("button", { name: "Fixture workspace, fixture" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
		expect(globalThis.document.querySelectorAll("iframe")).toHaveLength(1);
		expect(globalThis.document.querySelectorAll("main")).toHaveLength(1);
		expect(
			globalThis.document.querySelectorAll('[data-testid="authenticated-shell"]'),
		).toHaveLength(1);
		expect(Schema.decodeUnknownSync(PluginBridgeLocation)(bridge.messages[0])).toMatchObject({
			location: { path: "/", search: "", kind: "route" },
		});
	});

	it("uses the normal plugin home route when no override is selected", async () => {
		const view = mount({ entry: "/fixture" });
		await screen.findByTitle("fixture plugin");

		expect(view.targets).toEqual([
			{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
		]);
		expect(view.router.state.location.pathname).toBe("/fixture");
	});

	it("shows a selected home-view preparation error without falling back", async () => {
		const savedViewId = SavedViewId.make("broken-home-view");
		const targets: ClientPageTarget[] = [];
		mount({
			entry: "/fixture",
			entries: [{ ...catalog[0], homeSavedViewId: savedViewId }],
			prepare: (_scope, request) => {
				targets.push(request.payload.target);
				return preparationFailure({ code: "plugin-unavailable", pluginId: "renderer-plugin" });
			},
		});

		await screen.findByRole("heading", { name: "Plugin page not found" });
		expect(targets).toEqual([
			{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
		]);
		expect(screen.queryByTitle(/plugin$/)).toBeNull();
	});

	it("shows a selected home-view build failure without falling back", async () => {
		const savedViewId = SavedViewId.make("failed-home-view");
		const targets: ClientPageTarget[] = [];
		mount({
			entry: "/fixture",
			entries: [{ ...catalog[0], homeSavedViewId: savedViewId }],
			prepare: (_scope, request) => {
				targets.push(request.payload.target);
				return Effect.fail(new AuthenticatedApiError({ cause: new Error("build failed") }));
			},
		});

		await screen.findByRole("heading", { name: "Plugin page unavailable" });
		expect(targets).toEqual([
			{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
		]);
		expect(screen.queryByTitle(/plugin$/)).toBeNull();
	});

	it("prepares an ordinary plugin route with its artifact grant", async () => {
		const view = mount({ entry: "/fixture/details/one?tab=stats" });
		const frame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const bridge = connectFrame(frame);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		expect(view.targets).toEqual([
			{ search: "tab=stats", path: "/details/one", kind: "plugin-route", pluginSlug: "fixture" },
		]);
		expect(frame.getAttribute("src")).toContain("artifact-plugin-1");
		expect(Schema.decodeUnknownSync(PluginBridgeLocation)(bridge.messages[0])).toMatchObject({
			location: { kind: "route", search: "tab=stats", path: "/details/one" },
		});
		bridge.port.postMessage({
			input: null,
			pluginSlug: "fixture",
			operationSlug: "greet",
			requestId: "operation-1",
			type: "operation-request",
		});
		bridge.port.postMessage({
			input: null,
			operationSlug: "mutate",
			requestId: "operation-2",
			type: "operation-request",
			pluginSlug: "operations-only",
		});
		bridge.port.postMessage({
			input: null,
			operationSlug: "mutate",
			requestId: "operation-3",
			type: "operation-request",
			pluginSlug: "newly-installed",
		});
		await waitFor(() => expect(view.operations).toHaveLength(2));
		await waitFor(() =>
			expect(bridge.messages).toContainEqual({
				outcome: "failure",
				type: "operation-result",
				requestId: "operation-3",
				reason: "operation-failed",
			}),
		);
		expect(view.operations[0]).toMatchObject({
			sourceHash: "source-plugin-1",
			request: { input: null, pluginSlug: "fixture", operationSlug: "greet" },
		});
		expect(view.operations[1]).toMatchObject({
			sourceHash: "operations-only-source",
			request: { input: null, operationSlug: "mutate", pluginSlug: "operations-only" },
		});
	});

	it("reuses one artifact runtime for plugin and entity routes", async () => {
		const view = mount({ entry: "/fixture/details/one" });
		const pluginFrame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");

		await view.router.navigate({ href: "/e/entity-1" });
		await waitFor(() =>
			expect(view.targets.at(-1)).toEqual({ kind: "entity", entityId: "entity-1" }),
		);
		expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(pluginFrame);

		await view.router.navigate({ href: "/e/entity-2" });
		await waitFor(() =>
			expect(view.targets.at(-1)).toEqual({ kind: "entity", entityId: "entity-2" }),
		);
		expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(pluginFrame);

		await view.router.navigate({ href: "/fixture/details/one" });
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture/details/one"));
		expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(pluginFrame);
	});

	it("reuses the artifact runtime when prepared settings change", async () => {
		let defaultLayout = "grid";
		const view = mount({
			entry: "/fixture/details/one",
			prepare: (_scope, request) => {
				const target = request.payload.target;
				if (target.kind === "saved-view") {
					return Effect.succeed(preparedSavedView(SavedViewId.make(target.slug)));
				}
				const prepared = preparedFor(
					target,
					target.kind === "plugin-route" && target.pluginSlug === "journal"
						? "plugin-2"
						: "plugin-1",
				);
				return Effect.succeed({
					...prepared,
					context: { ...prepared.context, settings: { defaultLayout } },
				});
			},
		});
		const frame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");

		await view.router.navigate({ href: "/fixture/details/two" });
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture/details/two"));
		expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(frame);

		defaultLayout = "list";
		await view.router.navigate({ href: "/fixture/details/one" });
		expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(frame);
	});

	it("drops retained artifact runtimes when the api scope changes", async () => {
		let userId = "user-1";
		const entries = Array.from({ length: 2 }, (_, index) => ({
			...catalog[0],
			name: `Plugin ${index + 1}`,
			slug: `plugin-${index + 1}`,
			pluginId: `plugin-${index + 1}`,
			installationId: `installation-${index + 1}`,
		}));
		const view = mount({
			entries,
			entry: "/plugin-1",
			auth: makeAuthStub({
				settledSession: () =>
					Effect.succeed({
						status: "authenticated",
						accessClass: "standard",
						user: { id: userId, image: null, name: "Test User", email: "user@ryot.example" },
					}),
			}),
		});
		await screen.findByTitle("fixture plugin");
		await view.router.navigate({ href: "/plugin-2" });
		await waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2));

		userId = "user-2";
		await act(async () => {
			await view.router.invalidate();
		});

		await waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(1));
	});

	it("evicts the least recently active frame after retaining three realms", async () => {
		const entries = Array.from({ length: 4 }, (_, index) => ({
			...catalog[0],
			name: `Plugin ${index + 1}`,
			slug: `plugin-${index + 1}`,
			pluginId: `plugin-${index + 1}`,
			installationId: `installation-${index + 1}`,
		}));
		const view = mount({ entries, entry: "/plugin-1" });
		await screen.findByTitle("fixture plugin");
		await view.router.navigate({ href: "/plugin-2" });
		await waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2));
		await view.router.navigate({ href: "/plugin-3" });
		await waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3));
		await view.router.navigate({ href: "/plugin-4" });
		await waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3));

		await view.router.navigate({ href: "/plugin-2" });
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/plugin-2"));
		expect(document.querySelectorAll("iframe")).toHaveLength(3);

		await view.router.navigate({ href: "/plugin-1" });
		await waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3));
	});

	it("uses freshly prepared operation targets and reloads a stale artifact on request", async () => {
		let preparation = 0;
		const view = mount({
			entry: "/fixture/details/one",
			check: () => Effect.succeed(false),
			prepare: (_scope, request) => {
				const target = request.payload.target;
				if (target.kind !== "plugin-route") {
					return Effect.die("not used");
				}
				preparation += 1;
				const prepared = preparedFor(target);
				if (preparation === 1) {
					return Effect.succeed(prepared);
				}
				const operationTargets = [
					...prepared.identity.operationTargets.map((operationTarget) =>
						operationTarget.pluginSlug === "operations-only"
							? { ...operationTarget, sourceHash: "operations-only-updated" }
							: operationTarget,
					),
					{
						pluginId: "newly-installed-id",
						sourceHash: "newly-installed-source",
						pluginSlug: PluginSlug.make("newly-installed"),
						installationId: "newly-installed-installation",
					},
				];
				return Effect.succeed({
					...prepared,
					identity: { ...prepared.identity, operationTargets },
				});
			},
		});
		const firstFrame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const firstBridge = connectFrame(firstFrame);
		await waitFor(() => expect(firstBridge.messages).toHaveLength(1));

		await view.router.navigate({ href: "/fixture/details/two" });
		await waitFor(() => expect(preparation).toBe(2));
		const nextFrame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
		expect(nextFrame).toBe(firstFrame);
		firstBridge.port.postMessage({
			input: null,
			operationSlug: "mutate",
			type: "operation-request",
			requestId: "retained-target",
			pluginSlug: "operations-only",
		});
		firstBridge.port.postMessage({
			input: null,
			requestId: "new-target",
			operationSlug: "mutate",
			type: "operation-request",
			pluginSlug: "newly-installed",
		});
		await waitFor(() => expect(view.operations).toHaveLength(2));
		expect(view.operations[0]).toMatchObject({ sourceHash: "operations-only-updated" });
		expect(view.operations[1]).toMatchObject({ sourceHash: "newly-installed-source" });

		act(() => view.events.send());
		await screen.findByText("An update is available. Reloading will discard unsaved local state.");
		fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
		await waitFor(() => expect(preparation).toBe(3));
		const reloadedFrame = await waitFor(() => {
			const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
			expect(frame).not.toBe(firstFrame);
			return frame;
		});
		expect(reloadedFrame).not.toBe(firstFrame);
		const reloadedBridge = connectFrame(reloadedFrame);
		reloadedBridge.port.postMessage({
			input: null,
			operationSlug: "mutate",
			type: "operation-request",
			requestId: "updated-target",
			pluginSlug: "operations-only",
		});
		reloadedBridge.port.postMessage({
			input: null,
			operationSlug: "mutate",
			type: "operation-request",
			requestId: "adopted-target",
			pluginSlug: "newly-installed",
		});
		await waitFor(() => expect(view.operations).toHaveLength(4));
		expect(view.operations[2]).toMatchObject({ sourceHash: "operations-only-updated" });
		expect(view.operations[3]).toMatchObject({ sourceHash: "newly-installed-source" });
	});

	it("uses explicit plugin navigation and merges page search with null deletion", async () => {
		const view = mount({ entry: "/fixture?keep=1&dialog=open" });
		const bridge = connectFrame(await screen.findByTitle("fixture plugin"));
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		const initialNavigation = Schema.decodeUnknownSync(PluginBridgeLocation)(bridge.messages[0]);
		bridge.port.postMessage({
			mode: "push",
			type: "navigate",
			target: { search: "q=x", path: "/entries", kind: "plugin-route", pluginSlug: "journal" },
		});
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/journal/entries"));
		expect(view.router.state.location.state.ryotEntryKey).toEqual(expect.any(String));
		expect(view.router.state.location.state.ryotEntryKey).not.toBe(initialNavigation.key);

		view.unmount();
		const searchView = mount({ entry: "/fixture?keep=1&dialog=open" });
		const searchBridge = connectFrame(
			await screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
		);
		await waitFor(() => expect(searchBridge.messages).toHaveLength(1));
		const initialSearch = Schema.decodeUnknownSync(PluginBridgeLocation)(searchBridge.messages[0]);
		searchBridge.port.postMessage({
			mode: "replace",
			type: "page-search",
			update: { q: "dune", dialog: null },
		});
		await waitFor(() => expect(searchView.router.state.location.searchStr).toBe("?keep=1&q=dune"));
		await waitFor(() => expect(searchBridge.messages).toHaveLength(2));
		const replacedSearch = Schema.decodeUnknownSync(PluginBridgeLocation)(searchBridge.messages[1]);
		expect(replacedSearch).toMatchObject({ key: initialSearch.key, index: initialSearch.index });
	});

	it("prepares entities directly and allows a disabled ready installation", async () => {
		const entries = [{ ...catalog[0], isDisabled: true }];
		const view = mount({ entries, entry: "/e/entity-1?tab=activity" });
		const frame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const bridge = connectFrame(frame);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		expect(view.targets).toEqual([{ kind: "entity", entityId: EntityId.make("entity-1") }]);
		expect(Schema.decodeUnknownSync(PluginBridgeLocation)(bridge.messages[0])).toMatchObject({
			location: {
				kind: "entity",
				entityId: "entity-1",
				search: "tab=activity",
				entitySchemaSlug: "book",
			},
		});
	});

	it.each([
		[{ code: "entity-not-found", entityId: EntityId.make("missing") }, "Entity not found"],
		[
			{
				ownerPluginId: "plugin-2",
				code: "entity-owner-unavailable",
				entityId: EntityId.make("missing"),
			},
			"Required plugin unavailable",
		],
		[
			{
				ownerPluginId: "plugin-1",
				entityId: EntityId.make("missing"),
				code: "entity-detail-page-not-registered",
				entitySchemaSlug: EntitySchemaSlug.make("book"),
			},
			"Entity page not registered",
		],
	] as const)("renders the explicit entity preparation branch %#", async (reason, title) => {
		mount({ entry: "/e/missing", prepare: () => preparationFailure(reason) });
		await screen.findByRole("heading", { name: title });
		expect(screen.queryByTitle(/plugin$/)).toBeNull();
	});

	it("renders an unregistered plugin page without mounting an artifact", async () => {
		mount({
			entry: "/fixture/missing",
			prepare: () =>
				preparationFailure({
					path: "/missing",
					pluginId: "plugin-1",
					code: "plugin-route-not-registered",
				}),
		});
		await screen.findByRole("heading", { name: "Plugin page not found" });
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
	});
});
