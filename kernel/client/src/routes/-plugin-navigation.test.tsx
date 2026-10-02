import { describe, expect, it } from "@effect/vitest";
// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_BOOTSTRAP_READY,
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

import { AuthenticatedApiError } from "#/api/authenticated";
import { ClientPagesApi } from "#/api/client-pages";
import { KernelApiTestLayer } from "#/api/ports.test-layer";
import { ClientPageFreshness } from "#/modules/client-pages/freshness";
import { EntitiesService } from "#/modules/entities/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { makePluginQueries, makePluginStorage } from "#/modules/plugins/services.test-layer";
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
	clientCompositionDocument,
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
		composition: {
			format: CLIENT_ARTIFACT_FORMAT,
			apiVersion: CLIENT_API_VERSION,
			hash: `composition-${pluginId}`,
			compilerVersion: CLIENT_COMPILER_VERSION,
			bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		},
		identity: {
			target,
			pluginId,
			exportName: "page",
			kind: "plugin-page",
			sourceHash: `source-${pluginId}`,
			installationId: `installation-${pluginId}`,
			compositionHash: `composition-${pluginId}`,
			compositionKey: `composition-key-${pluginId}`,
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
			contributors: prepared.identity.contributors,
			compositionKey: prepared.identity.compositionKey,
			target: { slug: savedViewId, kind: "saved-view" },
			compositionHash: prepared.identity.compositionHash,
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
	let documentLoads = 0;
	const loadDocument: ClientPagesApi["Service"]["document"] = (_scope, request) => {
		documentLoads += 1;
		return Effect.succeed(
			clientCompositionDocument(
				request.payload.identity.compositionHash,
				`document-${documentLoads}`,
			),
		);
	};
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
				document: loadDocument,
				checkFreshness: () => Effect.succeed({ current: true }),
			}),
			Layer.succeed(ClientPageFreshness, { check: options.check ?? (() => Effect.succeed(true)) }),
			Layer.succeed(PluginOperationsService, {
				invoke: (input) => {
					operations.push(input);
					return Effect.succeed({ value: null, outcome: "success" });
				},
			}),
			makePluginQueries(),
			makePluginStorage(),
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
	return {
		...view,
		events,
		router,
		targets,
		operations,
		getCatalogLoads: () => catalogLoads,
		getDocumentLoads: () => documentLoads,
	};
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
	const readyEvent = new MessageEvent("message", { data: { type: CLIENT_BRIDGE_BOOTSTRAP_READY } });
	Object.defineProperty(readyEvent, "source", { value: frame.contentWindow });
	fireEvent(window, readyEvent);
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
	it.live("prepares a saved-view slug without loading a saved-view record", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/v/fixture-view" });
			yield* Effect.promise(() =>
				waitFor(() => expect(view.targets).toEqual([{ kind: "saved-view", slug: "fixture-view" }])),
			);
		}),
	);

	it.live("uses prepared saved-view metadata and the route slug for local layout", () =>
		Effect.gen(function* () {
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
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture View plugin"),
			);
			const bridge = connectFrame(frame);
			expect(layoutKeys).toEqual(["fixture-view"]);
			expect(bridge.init.page?.settings).toMatchObject({ defaultLayout: "grid" });
			expect(view.router.state.location.pathname).toBe("/v/fixture-view");
			bridge.port.postMessage({
				entitySchemaSlug: "book",
				ownerPluginId: "plugin-1",
				type: "provider-search-screen",
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.searchStr).toBe("?add=true")),
			);
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
		}),
	);

	it.live("opens provider search from a plugin route without changing the page location", () =>
		Effect.gen(function* () {
			const view = mount({
				entry: "/fixture?tab=home",
				loadProviders: () =>
					Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } }),
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("fixture plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({
				initialQuery: "dune",
				entitySchemaSlug: "book",
				ownerPluginId: "plugin-1",
				type: "provider-search-screen",
			});

			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			expect(
				screen.getByRole<HTMLInputElement>("textbox", { name: "Search providers" }).value,
			).toBe("dune");
			expect(view.router.state.location.searchStr).toBe("?tab=home");
			expect(view.targets).toHaveLength(1);

			fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("dialog", { name: "Add from a provider" })).toBeNull(),
				),
			);
			expect(view.router.state.location.searchStr).toBe("?tab=home");
		}),
	);

	it.live("uses the hydrated parent catalog on plugin navigation", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/fixture" });
			yield* Effect.promise(() => screen.findByTitle("fixture plugin"));
			expect(view.getCatalogLoads()).toBe(1);
			yield* Effect.promise(() => view.router.navigate({ href: "/fixture/details/one" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.targets.at(-1)).toEqual({
						search: "",
						path: "/details/one",
						kind: "plugin-route",
						pluginSlug: "fixture",
					}),
				),
			);
			expect(view.getCatalogLoads()).toBe(1);
		}),
	);

	it.live("renders the selected home view at the active workspace URL through one page host", () =>
		Effect.gen(function* () {
			const savedViewId = SavedViewId.make("home-view-1");
			const view = mount({
				entry: "/fixture",
				entries: [{ ...catalog[0], homeSavedViewSlug: savedViewId }],
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

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
			expect(
				yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(bridge.messages[0]),
			).toMatchObject({ location: { path: "/", search: "", kind: "route" } });
		}),
	);

	it.live("uses the normal plugin home route when no override is selected", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/fixture" });
			yield* Effect.promise(() => screen.findByTitle("fixture plugin"));

			expect(view.targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
			]);
			expect(view.router.state.location.pathname).toBe("/fixture");
		}),
	);

	it.live("shows a selected home-view preparation error without falling back", () =>
		Effect.gen(function* () {
			const savedViewId = SavedViewId.make("broken-home-view");
			const targets: ClientPageTarget[] = [];
			mount({
				entry: "/fixture",
				entries: [{ ...catalog[0], homeSavedViewSlug: savedViewId }],
				prepare: (_scope, request) => {
					targets.push(request.payload.target);
					return preparationFailure({ code: "plugin-unavailable", pluginId: "renderer-plugin" });
				},
			});

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Plugin page not found" }));
			expect(targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
			]);
			expect(screen.queryByTitle(/plugin$/)).toBeNull();
		}),
	);

	it.live("shows a selected home-view build failure without falling back", () =>
		Effect.gen(function* () {
			const savedViewId = SavedViewId.make("failed-home-view");
			const targets: ClientPageTarget[] = [];
			mount({
				entry: "/fixture",
				entries: [{ ...catalog[0], homeSavedViewSlug: savedViewId }],
				prepare: (_scope, request) => {
					targets.push(request.payload.target);
					return Effect.fail(new AuthenticatedApiError({ cause: new Error("build failed") }));
				},
			});

			yield* Effect.promise(() =>
				screen.findByRole("heading", { name: "Plugin page unavailable" }),
			);
			expect(targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", pluginSlug: "fixture" },
			]);
			expect(screen.queryByTitle(/plugin$/)).toBeNull();
		}),
	);

	it.live("prepares an ordinary plugin route and loads its document into srcdoc", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/fixture/details/one?tab=stats" });
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			expect(view.targets).toEqual([
				{ search: "tab=stats", path: "/details/one", kind: "plugin-route", pluginSlug: "fixture" },
			]);
			expect(frame.hasAttribute("src")).toBe(false);
			expect(frame.getAttribute("srcdoc")).toContain('"hash":"composition-plugin-1"');
			expect(frame.getAttribute("srcdoc")).toContain("<title>document-1</title>");
			expect(view.getDocumentLoads()).toBe(1);
			expect(
				yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(bridge.messages[0]),
			).toMatchObject({ location: { kind: "route", search: "tab=stats", path: "/details/one" } });
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
			yield* Effect.promise(() => waitFor(() => expect(view.operations).toHaveLength(2)));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "failure",
						type: "operation-result",
						requestId: "operation-3",
						reason: "operation-failed",
					}),
				),
			);
			expect(view.operations[0]).toMatchObject({
				sourceHash: "source-plugin-1",
				request: { input: null, pluginSlug: "fixture", operationSlug: "greet" },
			});
			expect(view.operations[1]).toMatchObject({
				sourceHash: "operations-only-source",
				request: { input: null, operationSlug: "mutate", pluginSlug: "operations-only" },
			});
		}),
	);

	it.live("reuses one composition runtime and bridge for plugin and entity documents", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/fixture/details/one" });
			const pluginFrame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(pluginFrame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const initialSrcDoc = pluginFrame.getAttribute("srcdoc");

			yield* Effect.promise(() => view.router.navigate({ href: "/e/entity-1" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.targets.at(-1)).toEqual({ kind: "entity", entityId: "entity-1" }),
				),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(pluginFrame);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							page: expect.objectContaining({
								target: expect.objectContaining({ entityId: "entity-1" }),
							}),
						}),
					),
				),
			);
			expect(pluginFrame.getAttribute("srcdoc")).toBe(initialSrcDoc);
			expect(view.getDocumentLoads()).toBe(1);

			yield* Effect.promise(() => view.router.navigate({ href: "/e/entity-2" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.targets.at(-1)).toEqual({ kind: "entity", entityId: "entity-2" }),
				),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(pluginFrame);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							page: expect.objectContaining({
								target: expect.objectContaining({ entityId: "entity-2" }),
							}),
						}),
					),
				),
			);

			yield* Effect.promise(() => view.router.navigate({ href: "/fixture/details/one" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture/details/one")),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(pluginFrame);
		}),
	);

	it.live("keeps a retained composition's document when settings change", () =>
		Effect.gen(function* () {
			let defaultLayout = "grid";
			let preparations = 0;
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
					preparations++;
					return Effect.succeed({
						...prepared,
						context: { ...prepared.context, settings: { defaultLayout } },
					});
				},
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const firstSrcDoc = frame.getAttribute("srcdoc");

			yield* Effect.promise(() => view.router.navigate({ href: "/fixture/details/two" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture/details/two")),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(frame);
			expect(frame.getAttribute("srcdoc")).toBe(firstSrcDoc);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(expect.objectContaining({ type: "document" })),
				),
			);

			defaultLayout = "list";
			yield* Effect.promise(() => view.router.navigate({ href: "/fixture/details/three" }));
			yield* Effect.promise(() => waitFor(() => expect(preparations).toBe(3)));
			expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(frame);
			expect(frame.getAttribute("srcdoc")).toBe(firstSrcDoc);
			expect(view.getDocumentLoads()).toBe(1);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							page: expect.objectContaining({ settings: { defaultLayout: "list" } }),
						}),
					),
				),
			);
		}),
	);

	it.live("drops retained composition runtimes when the api scope changes", () =>
		Effect.gen(function* () {
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
			const first = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2)),
			);

			userId = "user-2";
			yield* Effect.promise(() => act(() => view.router.invalidate()));

			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(1)),
			);
			expect(document.querySelector("iframe")).not.toBe(first);
		}),
	);

	it.live("returns to a retained composition without navigating its iframe", () =>
		Effect.gen(function* () {
			const entries = Array.from({ length: 2 }, (_, index) => ({
				...catalog[0],
				slug: `plugin-${index + 1}`,
				pluginId: `plugin-${index + 1}`,
				installationId: `installation-${index + 1}`,
			}));
			const view = mount({ entries, entry: "/plugin-1" });
			const first = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(first);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const srcDoc = first.getAttribute("srcdoc");
			const wrapper = first.closest("main > div");
			const removed: Array<Node> = [];
			const observer = new MutationObserver((records) => {
				for (const record of records) {
					removed.push(...record.removedNodes);
				}
			});
			observer.observe(document.querySelector("main") ?? document.body, { childList: true });
			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2)),
			);
			expect(first.isConnected).toBe(true);
			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-1/details" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/plugin-1/details")),
			);
			expect(first.isConnected).toBe(true);
			expect(first.hasAttribute("src")).toBe(false);
			expect(first.getAttribute("srcdoc")).toBe(srcDoc);
			observer.disconnect();
			expect(wrapper).not.toBeNull();
			expect(removed).not.toContain(wrapper);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							page: expect.objectContaining({
								target: expect.objectContaining({ path: "/details" }),
							}),
						}),
					),
				),
			);
		}),
	);

	it.live("keeps a retained composition's document when revisited after a new preparation", () =>
		Effect.gen(function* () {
			let preparations = 0;
			const view = mount({
				entry: "/fixture",
				prepare: (_scope, request) => {
					const target = request.payload.target;
					if (target.kind !== "plugin-route") {
						return Effect.die("not used");
					}
					preparations++;
					return Effect.succeed(preparedFor(target));
				},
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const srcDoc = frame.getAttribute("srcdoc");

			yield* Effect.promise(() => view.router.navigate({ href: "/customize-sidebar" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/customize-sidebar")),
			);
			expect(frame.isConnected).toBe(true);

			yield* Effect.promise(() => view.router.navigate({ href: "/fixture/details" }));
			yield* Effect.promise(() => waitFor(() => expect(preparations).toBe(2)));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							page: expect.objectContaining({
								target: expect.objectContaining({ path: "/details" }),
							}),
						}),
					),
				),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("fixture plugin")).toBe(frame);
			expect(frame.getAttribute("srcdoc")).toBe(srcDoc);
			expect(view.getDocumentLoads()).toBe(1);
			expect(bridge.messages).not.toContainEqual({ reason: "disposed", type: "lifecycle-close" });
		}),
	);

	it.live("reprepares and replaces a failed iframe with a newly loaded document", () =>
		Effect.gen(function* () {
			let preparations = 0;
			const view = mount({
				entry: "/fixture",
				prepare: (_scope, request) => {
					const target = request.payload.target;
					if (target.kind !== "plugin-route") {
						return Effect.die("not used");
					}
					preparations++;
					return Effect.succeed(preparedFor(target));
				},
			});
			const first = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(first);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			expect(first.getAttribute("srcdoc")).toContain("<title>document-1</title>");
			bridge.port.postMessage({ reason: "failed", type: "lifecycle-close" });
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Retry" })));
			const next = yield* Effect.promise(() =>
				waitFor(() => {
					const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
					expect(frame).not.toBe(first);
					return frame;
				}),
			);
			expect(next.hasAttribute("src")).toBe(false);
			expect(next.getAttribute("srcdoc")).toContain("<title>document-2</title>");
			expect(first.isConnected).toBe(false);
			expect(preparations).toBe(2);
			view.unmount();
		}),
	);

	it.live("evicts the least recently active frame after retaining three realms", () =>
		Effect.gen(function* () {
			const entries = Array.from({ length: 4 }, (_, index) => ({
				...catalog[0],
				name: `Plugin ${index + 1}`,
				slug: `plugin-${index + 1}`,
				pluginId: `plugin-${index + 1}`,
				installationId: `installation-${index + 1}`,
			}));
			const view = mount({ entries, entry: "/plugin-1" });
			const first = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2)),
			);
			const second = [...document.querySelectorAll("iframe")].find((frame) => frame !== first);
			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-3" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3)),
			);
			const third = [...document.querySelectorAll("iframe")].find(
				(frame) => frame !== first && frame !== second,
			);
			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-4" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3)),
			);
			expect(first.isConnected).toBe(false);
			expect(second?.isConnected).toBe(true);

			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/plugin-2")),
			);
			expect(document.querySelectorAll("iframe")).toHaveLength(3);
			expect(second?.isConnected).toBe(true);

			yield* Effect.promise(() => view.router.navigate({ href: "/plugin-1" }));
			yield* Effect.promise(() => waitFor(() => expect(third?.isConnected).toBe(false)));
			expect(document.querySelectorAll("iframe")).toHaveLength(3);
			expect(first.isConnected).toBe(false);
			expect(second?.isConnected).toBe(true);
		}),
	);

	it.live(
		"uses freshly prepared operation targets and reloads an updated composition on request",
		() =>
			Effect.gen(function* () {
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
				const firstFrame = yield* Effect.promise(() =>
					screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
				);
				const firstBridge = connectFrame(firstFrame);
				yield* Effect.promise(() => waitFor(() => expect(firstBridge.messages).toHaveLength(1)));

				yield* Effect.promise(() => view.router.navigate({ href: "/fixture/details/two" }));
				yield* Effect.promise(() => waitFor(() => expect(preparation).toBe(2)));
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
				yield* Effect.promise(() => waitFor(() => expect(view.operations).toHaveLength(2)));
				expect(view.operations[0]).toMatchObject({ sourceHash: "operations-only-updated" });
				expect(view.operations[1]).toMatchObject({ sourceHash: "newly-installed-source" });

				act(() => view.events.send());
				yield* Effect.promise(() =>
					screen.findByText("An update is available. Reloading will discard unsaved local state."),
				);
				fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
				yield* Effect.promise(() => waitFor(() => expect(preparation).toBe(3)));
				const reloadedFrame = yield* Effect.promise(() =>
					waitFor(() => {
						const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
						expect(frame).not.toBe(firstFrame);
						return frame;
					}),
				);
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
				yield* Effect.promise(() => waitFor(() => expect(view.operations).toHaveLength(4)));
				expect(view.operations[2]).toMatchObject({ sourceHash: "operations-only-updated" });
				expect(view.operations[3]).toMatchObject({ sourceHash: "newly-installed-source" });
			}),
	);

	it.live("uses explicit plugin navigation and merges page search with null deletion", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/fixture?keep=1&dialog=open" });
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("fixture plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const initialNavigation = yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(
				bridge.messages[0],
			);
			bridge.port.postMessage({
				mode: "push",
				type: "navigate",
				target: { search: "q=x", path: "/entries", kind: "plugin-route", pluginSlug: "journal" },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/journal/entries")),
			);
			expect(view.router.state.location.state.ryotEntryKey).toEqual(expect.any(String));
			expect(view.router.state.location.state.ryotEntryKey).not.toBe(initialNavigation.key);

			view.unmount();
			const searchView = mount({ entry: "/fixture?keep=1&dialog=open" });
			const searchBridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("fixture plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(searchBridge.messages).toHaveLength(1)));
			const initialSearch = yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(
				searchBridge.messages[0],
			);
			searchBridge.port.postMessage({
				mode: "replace",
				type: "page-search",
				update: { q: "dune", dialog: null },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(searchView.router.state.location.searchStr).toBe("?keep=1&q=dune")),
			);
			yield* Effect.promise(() => waitFor(() => expect(searchBridge.messages).toHaveLength(2)));
			const replacedSearch = yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(
				searchBridge.messages[1],
			);
			expect(replacedSearch).toMatchObject({ key: initialSearch.key, index: initialSearch.index });
		}),
	);

	it.live("prepares entities directly and allows a hidden ready installation", () =>
		Effect.gen(function* () {
			const entries = [{ ...catalog[0], isHidden: true }];
			const view = mount({ entries, entry: "/e/entity-1?tab=activity" });
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			expect(view.targets).toEqual([{ kind: "entity", entityId: EntityId.make("entity-1") }]);
			expect(
				yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(bridge.messages[0]),
			).toMatchObject({
				location: {
					kind: "entity",
					entityId: "entity-1",
					search: "tab=activity",
					entitySchemaSlug: "book",
				},
			});
		}),
	);

	it.live.each([
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
	] as const)("renders the explicit entity preparation branch %#", ([reason, title]) =>
		Effect.gen(function* () {
			mount({ entry: "/e/missing", prepare: () => preparationFailure(reason) });
			yield* Effect.promise(() => screen.findByRole("heading", { name: title }));
			expect(screen.queryByTitle(/plugin$/)).toBeNull();
		}),
	);

	it.live("renders an unregistered plugin page without mounting an artifact", () =>
		Effect.gen(function* () {
			mount({
				entry: "/fixture/missing",
				prepare: () =>
					preparationFailure({
						path: "/missing",
						pluginId: "plugin-1",
						code: "plugin-route-not-registered",
					}),
			});
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Plugin page not found" }));
			expect(document.querySelectorAll("iframe")).toHaveLength(0);
		}),
	);
});
