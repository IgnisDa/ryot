import { describe, expect, it } from "@effect/vitest";
import { CollectionBadRequest } from "@ryot-app/contract/modules/collections/schemas";
import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import type {
	ImportEntityRunResult,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import {
	ClientPagePreparationError,
	type ClientPageTarget,
	type PreparedClientPage,
} from "@ryot-app/contract/modules/pages/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_BOOTSTRAP_READY,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	PluginBridgeInit,
	PluginBridgeLocation,
} from "@ryot-app/plugin-client-contract";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Deferred, Effect, Layer, ManagedRuntime, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { CollectionsApi } from "#/api/collections";
import { PagesApi } from "#/api/pages";
import { KernelApiTestLayer, makeCollectionsApi, makeRyotQLApi } from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import { BackgroundSubmissionService } from "#/modules/background-submissions/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { NavigationService } from "#/modules/navigation/service";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";
import {
	makePluginCalendarSources,
	makePluginEnrichment,
	makePluginEntitySaves,
	makePluginQueries,
	makePluginStorage,
} from "#/modules/pages/bridge/services.test-layer";
import { ClientPageFreshness } from "#/modules/pages/preparation/freshness";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/catalog/events.test-layer";
import { PluginCatalogService } from "#/modules/plugins/catalog/service";
import type { ProviderAddService } from "#/modules/provider-add/service";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	catalog,
	clientCompositionDocument,
	CustomizeRouteStubs,
	DeviceRouteStubs,
	ImportsRouteStubs,
	InstanceAdminRouteStubs,
	IntegrationRouteStubs,
	makeAuthStub,
	makeProviderAddStub,
	makePublicApiStub,
	makeStorageStub,
	ManagedAssetRouteStubs,
	navigationData,
	NotificationChannelRouteStubs,
	OAuthRouteStubs,
	ProviderAddRouteStubs,
	ServerStub,
	theme,
} from "#/routes/-route-fixtures";

const preparedFor = (
	target: Exclude<ClientPageTarget, { readonly kind: "saved-view" }>,
	pluginId = "plugin-1",
): PreparedClientPage => {
	const packageId = PluginPackageId.make(`test/${pluginId}`);
	const contributors: PreparedClientPage["identity"]["contributors"] = [
		{
			packageId,
			kind: "plugin",
			contentHash: `source-${pluginId}`,
			pluginId: PluginId.make(pluginId),
			revisionId: `revision-${pluginId}`,
			installationId: `installation-${pluginId}`,
		},
	];
	const entityTarget =
		target.kind === "entity"
			? {
					...target,
					entitySchemaPluginId: pluginId,
					entitySchemaSlug: EntitySchemaSlug.make("unit"),
				}
			: target;
	return {
		context: {
			view: null,
			contributors,
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
			contributors,
			exportName: "page",
			kind: "plugin-page",
			contentHash: `source-${pluginId}`,
			installationId: `installation-${pluginId}`,
			compositionHash: `composition-${pluginId}`,
			compositionKey: `composition-key-${pluginId}`,
			operationTargets: [
				{
					packageId,
					contentHash: `source-${pluginId}`,
					pluginId: PluginId.make(pluginId),
					installationId: `installation-${pluginId}`,
				},
				{
					contentHash: "operations-only-source",
					pluginId: PluginId.make("operations-only-id"),
					installationId: "operations-only-installation",
					packageId: PluginPackageId.make("test/operations-only"),
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
		packageId: PluginPackageId.make("test/plugin-1"),
	});
	return {
		...prepared,
		context: {
			...prepared.context,
			view: { icon: "list", name: "Fixture View" },
			renderer: { kind: "kernel", name: "dashboard" },
			target: { kind: "saved-view", reference: { savedViewId, kind: "custom" } },
		},
		identity: {
			savedViewId,
			viewRevision: 1,
			kind: "kernel-saved-view",
			rendererName: "dashboard",
			sourceHash: "source-plugin-1",
			contributors: prepared.identity.contributors,
			compositionKey: prepared.identity.compositionKey,
			compositionHash: prepared.identity.compositionHash,
			operationTargets: prepared.identity.operationTargets,
			target: { kind: "saved-view", reference: { savedViewId, kind: "custom" } },
		},
	};
};

const collectionResponse = (id: string, name: string) => ({
	name,
	warnings: [],
	properties: {},
	externalId: null,
	providerId: null,
	id: EntityId.make(id),
	entitySchemaPluginId: null,
	createdAt: "2026-10-20T00:00:00.000Z",
	updatedAt: "2026-10-20T00:00:00.000Z",
	entitySchemaSlug: EntitySchemaSlug.make("collection"),
});

function mount(options: {
	readonly entry: string;
	readonly pendingMs?: number;
	readonly entries?: PluginClientCatalog;
	readonly auth?: ReturnType<typeof makeAuthStub>;
	readonly storage?: ClientStorage["Service"];
	readonly loadProviders?: ProviderAddService["Service"]["loadProviders"];
	readonly providerAdd?: Partial<ProviderAddService["Service"]>;
	readonly prepare?: PagesApi["Service"]["prepare"];
	readonly check?: ClientPageFreshness["Service"]["check"];
	readonly collections?: Partial<CollectionsApi["Service"]>;
	readonly ryotql?: RyotQLApi["Service"]["execute"];
	readonly invoke?: PluginOperationsService["Service"]["invoke"];
}) {
	const targets: ClientPageTarget[] = [];
	let navigationLoads = 0;
	let documentLoads = 0;
	const loadDocument: PagesApi["Service"]["document"] = (_scope, request) => {
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
	const prepare: PagesApi["Service"]["prepare"] =
		options.prepare ??
		((_scope, request) => {
			targets.push(request.payload.target);
			const target = request.payload.target;
			if (target.kind === "saved-view") {
				return Effect.succeed(
					preparedSavedView(
						SavedViewId.make(
							target.reference.kind === "custom"
								? target.reference.savedViewId
								: target.reference.slug,
						),
					),
				);
			}
			const pluginId =
				target.kind === "plugin-route" ? target.packageId.replace("test/", "") : "plugin-1";
			return Effect.succeed(preparedFor(target, pluginId));
		});
	const events = makePluginCatalogEventsTestLayer();
	const operationsLayer = Layer.succeed(PluginOperationsService, {
		invoke: (input) => {
			operations.push(input);
			return options.invoke?.(input) ?? Effect.succeed({ value: null, outcome: "success" });
		},
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			options.loadProviders !== undefined || options.providerAdd !== undefined
				? makeProviderAddStub({
						...options.providerAdd,
						...(options.loadProviders === undefined
							? {}
							: { loadProviders: options.loadProviders }),
					})
				: ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			options.auth ?? makeAuthStub(),
			InstanceAdminRouteStubs,
			ServerStub,
			ManagedAssetRouteStubs,
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
			DeviceRouteStubs,
			Layer.succeed(NavigationService, {
				load: () =>
					Effect.sync(() => {
						navigationLoads += 1;
						return navigationData;
					}),
			}),
			CustomizeRouteStubs,
			Layer.succeed(PagesApi, {
				prepare,
				document: loadDocument,
				checkFreshness: () => Effect.succeed({ current: true }),
			}),
			Layer.succeed(ClientPageFreshness, { check: options.check ?? (() => Effect.succeed(true)) }),
			operationsLayer,
			BackgroundSubmissionService.layer.pipe(Layer.provide(operationsLayer)),
			makePluginQueries(),
			makePluginStorage(),
			makePluginCalendarSources(),
			makePluginEntitySaves(),
			makePluginEnrichment(),
			makeCollectionsApi(options.collections),
			makeRyotQLApi(options.ryotql === undefined ? {} : { execute: options.ryotql }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(
				Layer.succeed(ClientStorage, options.storage ?? makeStorageStub("plugin-1")),
			),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [options.entry] }),
	);
	if (options.pendingMs !== undefined) {
		router.update({
			...router.options,
			defaultPendingMinMs: 0,
			defaultPendingMs: options.pendingMs,
		});
	}
	const view = render(<RouterProvider router={router} />);
	return {
		...view,
		events,
		router,
		targets,
		operations,
		getCatalogLoads: () => catalogLoads,
		getDocumentLoads: () => documentLoads,
		getNavigationLoads: () => navigationLoads,
	};
}

const noProviders = () =>
	Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } });

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
	it.live.each([
		{
			title: "Opening Fixture",
			entry: "/p/test/plugin-1",
			prepared: preparedFor({
				path: "/",
				search: "",
				kind: "plugin-route",
				packageId: PluginPackageId.make("test/plugin-1"),
			}),
		},
		{
			title: "Opening Fixture",
			entry: "/p/test/plugin-1/details/one",
			prepared: preparedFor({
				search: "",
				kind: "plugin-route",
				path: "/details/one",
				packageId: PluginPackageId.make("test/plugin-1"),
			}),
		},
		{
			entry: "/v/c/fixture-view",
			title: "Opening Fixture View",
			prepared: preparedSavedView(SavedViewId.make("fixture-view")),
		},
		{
			entry: "/e/entity-1",
			title: "Opening Fixture",
			prepared: preparedFor({ kind: "entity", entityId: EntityId.make("entity-1") }),
		},
	])("uses the same interstitial while preparing $entry", ({ entry, title, prepared }) =>
		Effect.gen(function* () {
			const preparation = yield* Deferred.make<PreparedClientPage, AuthenticatedApiError>();
			const view = mount({
				pendingMs: 0,
				entry: "/settings/preferences",
				prepare: () => Deferred.await(preparation),
			});
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preferences" }));
			yield* Effect.forkChild(
				Effect.promise(() => view.router.navigate({ href: entry })),
				{ startImmediately: true },
			);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Opening your page" }));
			expect(screen.getAllByRole("main")).toHaveLength(1);
			expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
			expect(screen.getByRole("status").textContent).toContain("Getting your view ready");

			yield* Deferred.succeed(preparation, prepared);
			yield* Effect.promise(() => screen.findByRole("heading", { name: title }));
			expect(screen.getAllByRole("main")).toHaveLength(1);
			expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
			view.unmount();
		}),
	);

	it.live("prepares a saved-view slug without loading a saved-view record", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/v/c/fixture-view" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.targets).toEqual([
						{ kind: "saved-view", reference: { kind: "custom", savedViewId: "fixture-view" } },
					]),
				),
			);
		}),
	);

	it.live("reprepares same-composition saved views when only the path changes", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/v/c/first-view" });
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture View plugin"),
			);
			expect(window.getComputedStyle(frame).visibility).toBe("visible");
			expect(frame.closest('main[aria-hidden="true"]')).toBeNull();
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const srcDoc = frame.getAttribute("srcdoc");
			yield* Effect.promise(() => view.router.navigate({ href: "/v/c/second-view" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							type: "document",
							page: expect.objectContaining({
								target: {
									kind: "saved-view",
									reference: { kind: "custom", savedViewId: "second-view" },
								},
							}),
						}),
					),
				),
			);
			expect(view.targets).toEqual([
				{ kind: "saved-view", reference: { kind: "custom", savedViewId: "first-view" } },
				{ kind: "saved-view", reference: { kind: "custom", savedViewId: "second-view" } },
			]);
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture View plugin")).toBe(frame);
			expect(window.getComputedStyle(frame).visibility).toBe("visible");
			expect(frame.closest('main[aria-hidden="true"]')).toBeNull();
			expect(frame.getAttribute("srcdoc")).toBe(srcDoc);
			expect(view.getDocumentLoads()).toBe(1);
		}),
	);

	it.live("keeps pending search updates when another page-search request arrives", () =>
		Effect.gen(function* () {
			let preparations = 0;
			const view = mount({
				entry: "/v/c/fixture-view?keep=1",
				prepare: () => {
					preparations++;
					return preparations === 2
						? Effect.never
						: Effect.succeed(preparedSavedView(SavedViewId.make("fixture-view")));
				},
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture View plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({
				mode: "replace",
				type: "page-search",
				update: { sort: "name-desc" },
			});
			yield* Effect.promise(() => waitFor(() => expect(preparations).toBe(2)));
			bridge.port.postMessage({ mode: "replace", type: "page-search", update: { layout: "list" } });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.search).toMatchObject({
						keep: 1,
						layout: "list",
						sort: "name-desc",
					}),
				),
			);
		}),
	);

	it.live("uses prepared saved-view metadata and preserves the active provider search", () =>
		Effect.gen(function* () {
			const layoutKeys: string[] = [];
			const storage = makeStorageStub("plugin-1");
			const view = mount({
				entry: "/v/c/fixture-view",
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
								sourceName: "items",
								defaultLayout: "list",
								layouts: ["grid", "list"],
								summary: { image: null, subtitle: null },
								subject: {
									entityAlias: "entity",
									schemas: [{ slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } }],
								},
								addAction: {
									type: "provider-search",
									schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
									library: {
										librarySchemaSlug: "fixture-library",
										relationshipSlug: "in-fixture-library",
									},
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
			expect(layoutKeys).toEqual(["/v/c/fixture-view"]);
			expect(bridge.init.page?.settings).toMatchObject({ defaultLayout: "grid" });
			expect(view.router.state.location.pathname).toBe("/v/c/fixture-view");
			bridge.port.postMessage({
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.searchStr).toBe("?add=true")),
			);
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			bridge.port.postMessage({
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-2",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "success",
						value: { kind: "cancelled" },
						requestId: "pick-entity-screen-2",
						type: "pick-entity-screen-result",
					}),
				),
			);
			expect(screen.getByRole("dialog", { name: "Add from a provider" })).toBeTruthy();
			expect(view.router.state.location.searchStr).toBe("?add=true");
			fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("dialog", { name: "Add from a provider" })).toBeNull(),
				),
			);
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						"type" in message &&
						message.type === "pick-entity-screen-result",
				),
			).toEqual([
				{
					outcome: "success",
					value: { kind: "cancelled" },
					requestId: "pick-entity-screen-2",
					type: "pick-entity-screen-result",
				},
				{
					outcome: "success",
					value: { kind: "cancelled" },
					requestId: "pick-entity-screen-1",
					type: "pick-entity-screen-result",
				},
			]);
		}),
	);

	it.live("keeps the filters search value intact across host search rewrites", () =>
		Effect.gen(function* () {
			const filters =
				"eyJmaWVsZCI6ImxldmVsIiwidmFsdWVzIjpbImJlZ2lubmVyIl0sIm9wZXJhdG9yIjoiYW55T2YifQ";
			const view = mount({
				entry: `/v/c/fixture-view?filters=${filters}`,
				loadProviders: () =>
					Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } }),
				prepare: (_scope, request) => {
					const target = request.payload.target;
					if (target.kind !== "saved-view") {
						return Effect.die("not used");
					}
					const prepared = preparedSavedView(SavedViewId.make("internal-id"));
					const schema = { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } };
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
								sourceName: "items",
								defaultLayout: "list",
								layouts: ["grid", "list"],
								summary: { image: null, subtitle: null },
								subject: { schemas: [schema], entityAlias: "entity" },
								addAction: {
									schema,
									type: "provider-search",
									library: {
										librarySchemaSlug: "fixture-library",
										relationshipSlug: "in-fixture-library",
									},
								},
							},
						},
					});
				},
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture View plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			expect(view.router.state.location.search).toMatchObject({ filters });
			bridge.port.postMessage({
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.searchStr).toBe(`?filters=${filters}&add=true`),
				),
			);
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.searchStr).toBe(`?filters=${filters}`)),
			);
			const locations = bridge.messages.flatMap((message) =>
				typeof message === "object" && message !== null && "location" in message
					? [message.location]
					: [],
			);
			expect(locations.at(-1)).toMatchObject({ search: `filters=${filters}` });
		}),
	);

	it.live("shows the saved-view error state when entity-browser settings are undecodable", () =>
		Effect.gen(function* () {
			mount({
				entry: "/v/c/fixture-view",
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
							settings: { pageSize: 20 },
							renderer: { kind: "kernel", name: "Entity browser" },
						},
					});
				},
			});
			expect(yield* Effect.promise(() => screen.findByText("Saved view unavailable"))).toBeTruthy();
		}),
	);

	it.live("does not open provider search from add route state for a plugin-route action", () =>
		Effect.gen(function* () {
			const routeAction = {
				path: "/items/item-1",
				search: { tab: "history" },
				type: "plugin-route" as const,
				packageId: PluginPackageId.make("test/target"),
			};
			const view = mount({
				entry: "/v/c/fixture-view?add=true",
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
								sourceName: "items",
								defaultLayout: "list",
								addAction: routeAction,
								layouts: ["grid", "list"],
								summary: { image: null, subtitle: null },
								subject: {
									entityAlias: "entity",
									schemas: [{ slug: "unit", owner: { kind: "kernel" } }],
								},
							},
						},
					});
				},
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture View plugin"),
			);
			connectFrame(frame);
			expect(view.router.state.location.searchStr).toBe("?add=true");
			expect(screen.queryByRole("dialog", { name: "Add from a provider" })).toBeNull();
		}),
	);

	it.live("preserves the active plugin-route provider search on a second request", () =>
		Effect.gen(function* () {
			const view = mount({
				entry: "/p/test/plugin-1?tab=home",
				loadProviders: () =>
					Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } }),
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			bridge.port.postMessage({
				initialQuery: "sample",
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});

			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			expect(
				screen.getByRole<HTMLInputElement>("textbox", { name: "Search providers" }).value,
			).toBe("sample");
			expect(view.router.state.location.searchStr).toBe("?tab=home");
			expect(view.targets).toHaveLength(1);
			bridge.port.postMessage({
				initialQuery: "new query",
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-2",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "success",
						value: { kind: "cancelled" },
						requestId: "pick-entity-screen-2",
						type: "pick-entity-screen-result",
					}),
				),
			);
			expect(screen.getByRole("dialog", { name: "Add from a provider" })).toBeTruthy();
			expect(
				screen.getByRole<HTMLInputElement>("textbox", { name: "Search providers" }).value,
			).toBe("sample");

			fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("dialog", { name: "Add from a provider" })).toBeNull(),
				),
			);
			expect(
				bridge.messages.filter(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						"type" in message &&
						message.type === "pick-entity-screen-result",
				),
			).toEqual([
				{
					outcome: "success",
					value: { kind: "cancelled" },
					requestId: "pick-entity-screen-2",
					type: "pick-entity-screen-result",
				},
				{
					outcome: "success",
					value: { kind: "cancelled" },
					requestId: "pick-entity-screen-1",
					type: "pick-entity-screen-result",
				},
			]);
			expect(view.router.state.location.searchStr).toBe("?tab=home");
		}),
	);

	it.live("navigates to the schema create route with the query when Create custom is used", () =>
		Effect.gen(function* () {
			const view = mount({
				entry: "/p/test/plugin-1?tab=home",
				entries: [{ ...catalog[0], clientEntities: { unit: { createRoute: "/units/new" } } }],
				loadProviders: () =>
					Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } }),
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage({
				type: "pick-entity-screen",
				initialQuery: "sample part two",
				requestId: "pick-entity-screen-1",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});

			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			fireEvent.click(screen.getByRole("button", { name: "Create custom" }));

			yield* Effect.promise(() =>
				waitFor(() => {
					expect(view.router.state.location.pathname).toBe("/p/test/plugin-1/units/new");
					expect(view.router.state.location.searchStr).toBe("?name=sample+part+two");
				}),
			);
			expect(bridge.messages).toContainEqual({
				outcome: "success",
				requestId: "pick-entity-screen-1",
				type: "pick-entity-screen-result",
				value: { kind: "create-requested" },
			});
			expect(screen.queryByRole("dialog", { name: "Add from a provider" })).toBeNull();
		}),
	);

	it.live("offers no Create custom without a create route or editor for the schema", () =>
		Effect.gen(function* () {
			mount({
				entry: "/p/test/plugin-1?tab=home",
				loadProviders: () =>
					Effect.succeed({ items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } }),
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage({
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});

			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			expect(screen.queryByRole("button", { name: "Create custom" })).toBeNull();
		}),
	);

	it.live("returns the imported entity ID and closes provider search from a plugin route", () =>
		Effect.gen(function* () {
			const providerId = SandboxProviderId.make("provider-1");
			const entityId = EntityId.make("entity-added");
			const completed = {
				status: "completed",
				data: {
					id: entityId,
					name: "Sample",
					properties: {},
					providerId: null,
					populatedAt: null,
					externalId: "external-1",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					entitySchemaSlug: EntitySchemaSlug.make("unit"),
					entitySchemaPluginId: PluginId.make("plugin-1"),
				},
			} satisfies ImportEntityRunResult;
			const providerResponse = {
				providerId,
				providerName: "Provider 1",
				rootEntitySchemaSlug: EntitySchemaSlug.make("unit"),
				items: [{ title: "Sample", externalId: "external-1" }],
			} satisfies SearchProviderEntitiesResponse;
			const view = mount({
				entry: "/p/test/plugin-1?tab=home",
				providerAdd: {
					loadEntityLinks: () => Effect.succeed([]),
					pollImport: () => Effect.succeed(completed),
					search: () => Effect.succeed(providerResponse),
					startImport: () => Effect.succeed({ jobId: "job-1" }),
					loadProviders: () =>
						Effect.succeed({
							pageInfo: { limit: 100, hasMore: false, nextCursor: null },
							items: [
								{
									providerId,
									searchOptionsSchema: null,
									providerName: "Provider 1",
									providerSlug: "provider-1",
									rootEntitySchemaSlug: EntitySchemaSlug.make("unit"),
								},
							],
						}),
				},
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage({
				initialQuery: "Sample",
				type: "pick-entity-screen",
				requestId: "pick-entity-screen-1",
				schema: { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } },
				library: { librarySchemaSlug: "fixture-library", relationshipSlug: "in-fixture-library" },
			});
			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Add from a provider" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: "Add Sample" }));
			fireEvent.click(screen.getByRole("button", { name: "Add Sample" }));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "success",
						requestId: "pick-entity-screen-1",
						type: "pick-entity-screen-result",
						value: { kind: "selected", entityIds: [entityId] },
					}),
				),
			);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.queryByRole("dialog", { name: "Add from a provider" })).toBeNull(),
				),
			);
			expect(view.router.state.location.searchStr).toBe("?tab=home");
		}),
	);

	const unitSchema = { slug: "unit", owner: { kind: "plugin", pluginId: "plugin-1" } } as const;
	const pickRequest = (initialQuery: string) => ({
		initialQuery,
		schema: unitSchema,
		type: "pick-entity-screen",
		requestId: "pick-entity-screen-1",
	});
	const kindSchema = {
		fields: {
			kind: { label: "Kind", type: "string", description: "", validation: { required: true } },
		},
	} as const;

	it.live("lists visible entities matching the query and returns the picked ID", () =>
		Effect.gen(function* () {
			const queries: string[] = [];
			const entityId = EntityId.make("entity-sample");
			mount({
				entry: "/p/test/plugin-1?tab=home",
				providerAdd: {
					loadProviders: noProviders,
					loadSchema: () =>
						Effect.succeed({ name: "Unit", editor: null, propertiesSchema: { fields: {} } }),
					loadEntities: (_client, input) => {
						queries.push(input.query);
						return Effect.succeed({
							items: [{ id: entityId, name: "Sample" }],
							pageInfo: { limit: 30, hasMore: false, nextCursor: null },
						});
					},
				},
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(pickRequest("Sample"));

			yield* Effect.promise(() => screen.findByRole("dialog", { name: "Choose Unit" }));
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Sample" })));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "success",
						requestId: "pick-entity-screen-1",
						type: "pick-entity-screen-result",
						value: { kind: "selected", entityIds: [entityId] },
					}),
				),
			);
			expect(queries).toEqual(["Sample"]);
			expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull();
		}),
	);

	it.live("creates an entity inline through its editor with a stable retry key", () =>
		Effect.gen(function* () {
			const requests: EntityEditorSaveRequest[] = [];
			const entityId = EntityId.make("entity-created");
			mount({
				entry: "/p/test/plugin-1?tab=home",
				providerAdd: {
					loadProviders: noProviders,
					loadEntities: () =>
						Effect.succeed({
							items: [],
							pageInfo: { limit: 30, hasMore: false, nextCursor: null },
						}),
					loadSchema: () =>
						Effect.succeed({
							name: "Unit",
							propertiesSchema: kindSchema,
							editor: { relationships: [] },
						}),
					createEntity: (_scope, request) => {
						requests.push(request);
						return requests.length === 1
							? Effect.succeed({ kind: "invalid" as const, message: "Try that again." })
							: Effect.succeed({ entityId, kind: "saved" as const });
					},
				},
			});
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			bridge.port.postMessage(pickRequest("Rotator"));

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: 'Create "Rotator"' })),
			);
			const form = yield* Effect.promise(() => screen.findByRole("form", { name: "New Unit" }));
			expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Rotator");
			fireEvent.click(screen.getByRole("button", { name: "Create" }));
			yield* Effect.promise(() => screen.findByText("Kind is required"));
			expect(requests).toEqual([]);

			fireEvent.change(screen.getByRole("textbox", { name: "Kind" }), {
				target: { value: "muscle" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Create" }));
			yield* Effect.promise(() => screen.findByText("Try that again."));
			fireEvent.click(screen.getByRole("button", { name: "Create" }));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "success",
						requestId: "pick-entity-screen-1",
						type: "pick-entity-screen-result",
						value: { kind: "selected", entityIds: [entityId] },
					}),
				),
			);
			expect(form.isConnected).toBe(false);
			expect(requests).toHaveLength(2);
			expect(requests[0]?.submission).toEqual({
				action: "save",
				name: "Rotator",
				relationships: [],
				entitySchema: unitSchema,
				target: { kind: "create" },
				properties: { kind: "muscle" },
			});
			expect(requests[1]).toEqual(requests[0]);
		}),
	);

	it.live(
		"creates inline instead of leaving the caller when picking a schema with a create route",
		() =>
			Effect.gen(function* () {
				const entityId = EntityId.make("entity-created");
				const view = mount({
					entry: "/p/test/plugin-1?tab=home",
					entries: [{ ...catalog[0], clientEntities: { unit: { createRoute: "/units/new" } } }],
					providerAdd: {
						loadProviders: noProviders,
						createEntity: () => Effect.succeed({ entityId, kind: "saved" as const }),
						loadEntities: () =>
							Effect.succeed({
								items: [],
								pageInfo: { limit: 30, hasMore: false, nextCursor: null },
							}),
						loadSchema: () =>
							Effect.succeed({
								name: "Unit",
								propertiesSchema: kindSchema,
								editor: { relationships: [] },
							}),
					},
				});
				const bridge = connectFrame(
					yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
				);
				bridge.port.postMessage(pickRequest("sample"));

				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: 'Create "sample"' })),
				);
				yield* Effect.promise(() => screen.findByRole("form", { name: "New Unit" }));
				fireEvent.change(screen.getByRole("textbox", { name: "Kind" }), {
					target: { value: "novel" },
				});
				fireEvent.click(screen.getByRole("button", { name: "Create" }));

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(bridge.messages).toContainEqual({
							outcome: "success",
							requestId: "pick-entity-screen-1",
							type: "pick-entity-screen-result",
							value: { kind: "selected", entityIds: [entityId] },
						}),
					),
				);
				expect(view.router.state.location.pathname).toBe("/p/test/plugin-1");
			}),
	);

	it.live("uses the hydrated parent catalog on plugin navigation", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/p/test/plugin-1" });
			yield* Effect.promise(() => screen.findByTitle("Fixture plugin"));
			expect(view.getCatalogLoads()).toBe(1);
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details/one" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.targets.at(-1)).toEqual({
						search: "",
						path: "/details/one",
						kind: "plugin-route",
						packageId: "test/plugin-1",
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
				entry: "/p/test/plugin-1",
				entries: [{ ...catalog[0], homeSavedView: { savedViewId, kind: "custom" } }],
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			expect(view.targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", packageId: "test/plugin-1" },
			]);
			expect(view.router.state.location.pathname).toBe("/p/test/plugin-1");
			expect(screen.getByRole("button", { name: /^Fixture workspace,/ })).toBeTruthy();
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

	it.live("shows the workspace that owns the prepared entity page, not the remembered one", () =>
		Effect.gen(function* () {
			mount({
				entry: "/e/entity-1",
				storage: makeStorageStub("plugin-1"),
				prepare: (_scope, request) =>
					request.payload.target.kind === "entity"
						? Effect.succeed(preparedFor(request.payload.target, "plugin-2"))
						: Effect.die("not used"),
				entries: [
					catalog[0],
					{
						...catalog[0],
						sortOrder: 1,
						name: "Other",
						pluginId: PluginId.make("plugin-2"),
						installationId: "installation-plugin-2",
						packageId: PluginPackageId.make("test/plugin-2"),
					},
				],
			});

			yield* Effect.promise(() => screen.findByRole("button", { name: /^Other workspace,/ }));
			expect(screen.queryByRole("button", { name: /^Fixture workspace,/ })).toBeNull();
		}),
	);

	it.live("uses the normal plugin home route when no override is selected", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/p/test/plugin-1" });
			yield* Effect.promise(() => screen.findByTitle("Fixture plugin"));

			expect(view.targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", packageId: "test/plugin-1" },
			]);
			expect(view.router.state.location.pathname).toBe("/p/test/plugin-1");
		}),
	);

	it.live("shows a selected home-view preparation error without falling back", () =>
		Effect.gen(function* () {
			const savedViewId = SavedViewId.make("broken-home-view");
			const targets: ClientPageTarget[] = [];
			mount({
				entry: "/p/test/plugin-1",
				entries: [{ ...catalog[0], homeSavedView: { savedViewId, kind: "custom" } }],
				prepare: (_scope, request) => {
					targets.push(request.payload.target);
					return preparationFailure({ code: "plugin-unavailable", pluginId: "renderer-plugin" });
				},
			});

			yield* Effect.promise(() => screen.findByRole("heading", { name: "Plugin page not found" }));
			expect(targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", packageId: "test/plugin-1" },
			]);
			expect(screen.queryByTitle(/plugin$/)).toBeNull();
		}),
	);

	it.live("shows a selected home-view build failure without falling back", () =>
		Effect.gen(function* () {
			const savedViewId = SavedViewId.make("failed-home-view");
			const targets: ClientPageTarget[] = [];
			mount({
				entry: "/p/test/plugin-1",
				entries: [{ ...catalog[0], homeSavedView: { savedViewId, kind: "custom" } }],
				prepare: (_scope, request) => {
					targets.push(request.payload.target);
					return Effect.fail(new AuthenticatedApiError({ cause: new Error("build failed") }));
				},
			});

			yield* Effect.promise(() =>
				screen.findByRole("heading", { name: "Plugin page unavailable" }),
			);
			expect(targets).toEqual([
				{ path: "/", search: "", kind: "plugin-route", packageId: "test/plugin-1" },
			]);
			expect(screen.queryByTitle(/plugin$/)).toBeNull();
		}),
	);

	it.live("prepares an ordinary plugin route and loads its document into srcdoc", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/p/test/plugin-1/details/one?tab=stats" });
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));

			expect(view.targets).toEqual([
				{
					search: "tab=stats",
					path: "/details/one",
					kind: "plugin-route",
					packageId: "test/plugin-1",
				},
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
				operationSlug: "greet",
				requestId: "operation-1",
				type: "operation-request",
				packageId: "test/plugin-1",
			});
			bridge.port.postMessage({
				input: null,
				operationSlug: "mutate",
				requestId: "operation-2",
				type: "operation-request",
				packageId: "test/operations-only",
			});
			bridge.port.postMessage({
				input: null,
				operationSlug: "mutate",
				requestId: "operation-3",
				type: "operation-request",
				packageId: "test/newly-installed",
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
				contentHash: "source-plugin-1",
				request: { input: null, operationSlug: "greet", packageId: "test/plugin-1" },
			});
			expect(view.operations[1]).toMatchObject({
				contentHash: "operations-only-source",
				request: { input: null, operationSlug: "mutate", packageId: "test/operations-only" },
			});
		}),
	);

	it.live("runs a contributing plugin's background submission in the shell tray", () =>
		Effect.gen(function* () {
			const reply =
				yield* Deferred.make<
					Effect.Success<ReturnType<PluginOperationsService["Service"]["invoke"]>>
				>();
			const entries = catalog.map((entry) => ({
				...entry,
				installationId: "installation-plugin-1",
			}));
			const view = mount({
				entries,
				invoke: () => Deferred.await(reply),
				entry: "/p/test/plugin-1/details/one",
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const submit = (requestId: string, packageId: string) =>
				bridge.port.postMessage({
					requestId,
					packageId,
					operationSlug: "log",
					input: { episode: 1 },
					label: "Logged episode 1",
					idempotencyKey: `key-${requestId}`,
					type: "background-operation-request",
				});
			const replyTo = (requestId: string) =>
				bridge.messages.find(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						"requestId" in message &&
						message.requestId === requestId,
				);

			submit("own", "test/plugin-1");
			submit("other", "test/operations-only");
			yield* Effect.promise(() =>
				waitFor(() => expect([replyTo("own"), replyTo("other")]).not.toContain(undefined)),
			);
			expect(replyTo("own")).toMatchObject({
				requestId: "own",
				outcome: "success",
				type: "background-operation-accepted",
			});
			expect(replyTo("other")).toEqual({
				outcome: "failure",
				requestId: "other",
				reason: "operation-failed",
				type: "background-operation-accepted",
			});
			const tray = screen.getByRole("region", { name: "Background activity" });
			const entry = yield* Effect.promise(() =>
				within(tray).findByRole("article", { name: "Fixture: Logged episode 1" }),
			);
			expect(entry.textContent).toContain("Saving…");

			yield* Effect.promise(() => view.router.navigate({ href: "/settings/preferences" }));
			yield* Effect.promise(() => screen.findByRole("heading", { name: "Preferences" }));
			yield* Deferred.succeed(reply, { value: null, outcome: "success" });
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						within(screen.getByRole("region", { name: "Background activity" })).getByRole(
							"article",
							{ name: "Fixture: Logged episode 1" },
						).textContent,
					).toContain("Saved"),
				),
			);
			const accepted = replyTo("own");
			expect(bridge.messages).toContainEqual({
				outcome: { status: "succeeded" },
				type: "background-operation-settled",
				submissionId:
					typeof accepted === "object" && accepted !== null && "submissionId" in accepted
						? accepted.submissionId
						: undefined,
			});
			expect(view.operations).toEqual([
				{
					scope: expect.anything(),
					contentHash: "source-plugin-1",
					request: {
						operationSlug: "log",
						input: { episode: 1 },
						idempotencyKey: "key-own",
						packageId: "test/plugin-1",
					},
				},
			]);
		}),
	);

	it.live("reloads navigation after a plugin creates a collection", () =>
		Effect.gen(function* () {
			const view = mount({
				entry: "/p/test/plugin-1/details/one",
				collections: {
					create: (_scope, request) =>
						Effect.succeed(collectionResponse("collection-1", request.payload.name)),
				},
			});
			const frame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const loadsBefore = view.getNavigationLoads();

			bridge.port.postMessage({
				action: "create",
				requestId: "collection-1",
				type: "collection-request",
				input: { name: "Favorites" },
			});

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(
						expect.objectContaining({
							outcome: "success",
							requestId: "collection-1",
							type: "collection-result",
						}),
					),
				),
			);
			expect(view.getNavigationLoads()).toBeGreaterThan(loadsBefore);
		}),
	);

	it.live("reuses one composition runtime and bridge for plugin and entity documents", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/p/test/plugin-1/details/one" });
			const pluginFrame = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
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
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture plugin")).toBe(pluginFrame);
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
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture plugin")).toBe(pluginFrame);
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

			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details/one" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.pathname).toBe("/p/test/plugin-1/details/one"),
				),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture plugin")).toBe(pluginFrame);
		}),
	);

	it.live("keeps a retained composition's document when settings change", () =>
		Effect.gen(function* () {
			let defaultLayout = "grid";
			let preparations = 0;
			const view = mount({
				entry: "/p/test/plugin-1/details/one",
				prepare: (_scope, request) => {
					const target = request.payload.target;
					if (target.kind === "saved-view") {
						return Effect.succeed(
							preparedSavedView(
								SavedViewId.make(
									target.reference.kind === "custom"
										? target.reference.savedViewId
										: target.reference.slug,
								),
							),
						);
					}
					const prepared = preparedFor(
						target,
						target.kind === "plugin-route" && target.packageId === "test/plugin-2"
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
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const firstSrcDoc = frame.getAttribute("srcdoc");

			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details/two" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(view.router.state.location.pathname).toBe("/p/test/plugin-1/details/two"),
				),
			);
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture plugin")).toBe(frame);
			expect(frame.getAttribute("srcdoc")).toBe(firstSrcDoc);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual(expect.objectContaining({ type: "document" })),
				),
			);

			defaultLayout = "list";
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details/three" }));
			yield* Effect.promise(() => waitFor(() => expect(preparations).toBe(3)));
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture plugin")).toBe(frame);
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
				installationId: `installation-${index + 1}`,
				pluginId: PluginId.make(`plugin-${index + 1}`),
				packageId: PluginPackageId.make(`test/plugin-${index + 1}`),
			}));
			const view = mount({
				entries,
				entry: "/p/test/plugin-1",
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
				screen.findByTitle<HTMLIFrameElement>("Plugin 1 plugin"),
			);
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-2" }));
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
				installationId: `installation-${index + 1}`,
				pluginId: PluginId.make(`plugin-${index + 1}`),
				packageId: PluginPackageId.make(`test/plugin-${index + 1}`),
			}));
			const view = mount({ entries, entry: "/p/test/plugin-1" });
			const first = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
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
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2)),
			);
			expect(first.isConnected).toBe(true);
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/p/test/plugin-1/details")),
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
				entry: "/p/test/plugin-1",
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
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(frame);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const srcDoc = frame.getAttribute("srcdoc");

			yield* Effect.promise(() => view.router.navigate({ href: "/customize-sidebar" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/customize-sidebar")),
			);
			expect(frame.isConnected).toBe(true);

			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details" }));
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
			expect(screen.getByTitle<HTMLIFrameElement>("Fixture plugin")).toBe(frame);
			expect(frame.getAttribute("srcdoc")).toBe(srcDoc);
			expect(view.getDocumentLoads()).toBe(1);
			expect(bridge.messages).not.toContainEqual({ reason: "disposed", type: "lifecycle-close" });
		}),
	);

	it.live("reprepares and replaces a failed iframe with a newly loaded document", () =>
		Effect.gen(function* () {
			let preparations = 0;
			const view = mount({
				entry: "/p/test/plugin-1",
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
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
			);
			const bridge = connectFrame(first);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			expect(first.getAttribute("srcdoc")).toContain("<title>document-1</title>");
			bridge.port.postMessage({ reason: "failed", type: "lifecycle-close" });
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Retry" })));
			const next = yield* Effect.promise(() =>
				waitFor(() => {
					const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
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
				installationId: `installation-${index + 1}`,
				pluginId: PluginId.make(`plugin-${index + 1}`),
				packageId: PluginPackageId.make(`test/plugin-${index + 1}`),
			}));
			const view = mount({ entries, entry: "/p/test/plugin-1" });
			const first = yield* Effect.promise(() =>
				screen.findByTitle<HTMLIFrameElement>("Plugin 1 plugin"),
			);
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2)),
			);
			const second = [...document.querySelectorAll("iframe")].find((frame) => frame !== first);
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-3" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3)),
			);
			const third = [...document.querySelectorAll("iframe")].find(
				(frame) => frame !== first && frame !== second,
			);
			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-4" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(3)),
			);
			expect(first.isConnected).toBe(false);
			expect(second?.isConnected).toBe(true);

			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-2" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/p/test/plugin-2")),
			);
			expect(document.querySelectorAll("iframe")).toHaveLength(3);
			expect(second?.isConnected).toBe(true);

			yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1" }));
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
					check: () => Effect.succeed(false),
					entry: "/p/test/plugin-1/details/one",
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
								operationTarget.packageId === "test/operations-only"
									? { ...operationTarget, contentHash: "operations-only-updated" }
									: operationTarget,
							),
							{
								contentHash: "newly-installed-source",
								pluginId: PluginId.make("newly-installed-id"),
								installationId: "newly-installed-installation",
								packageId: PluginPackageId.make("test/newly-installed"),
							},
						];
						return Effect.succeed({
							...prepared,
							identity: { ...prepared.identity, operationTargets },
						});
					},
				});
				const firstFrame = yield* Effect.promise(() =>
					screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
				);
				const firstBridge = connectFrame(firstFrame);
				yield* Effect.promise(() => waitFor(() => expect(firstBridge.messages).toHaveLength(1)));

				yield* Effect.promise(() => view.router.navigate({ href: "/p/test/plugin-1/details/two" }));
				yield* Effect.promise(() => waitFor(() => expect(preparation).toBe(2)));
				const nextFrame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
				expect(nextFrame).toBe(firstFrame);
				firstBridge.port.postMessage({
					input: null,
					operationSlug: "mutate",
					type: "operation-request",
					requestId: "retained-target",
					packageId: "test/operations-only",
				});
				firstBridge.port.postMessage({
					input: null,
					requestId: "new-target",
					operationSlug: "mutate",
					type: "operation-request",
					packageId: "test/newly-installed",
				});
				yield* Effect.promise(() => waitFor(() => expect(view.operations).toHaveLength(2)));
				expect(view.operations[0]).toMatchObject({ contentHash: "operations-only-updated" });
				expect(view.operations[1]).toMatchObject({ contentHash: "newly-installed-source" });

				act(() => view.events.send());
				yield* Effect.promise(() =>
					screen.findByText("An update is available. Reloading will discard unsaved local state."),
				);
				fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
				yield* Effect.promise(() => waitFor(() => expect(preparation).toBe(3)));
				const reloadedFrame = yield* Effect.promise(() =>
					waitFor(() => {
						const frame = screen.getByTitle<HTMLIFrameElement>("Fixture plugin");
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
					packageId: "test/operations-only",
				});
				reloadedBridge.port.postMessage({
					input: null,
					operationSlug: "mutate",
					type: "operation-request",
					requestId: "adopted-target",
					packageId: "test/newly-installed",
				});
				yield* Effect.promise(() => waitFor(() => expect(view.operations).toHaveLength(4)));
				expect(view.operations[2]).toMatchObject({ contentHash: "operations-only-updated" });
				expect(view.operations[3]).toMatchObject({ contentHash: "newly-installed-source" });
			}),
	);

	it.live("uses explicit plugin navigation and merges page search with null deletion", () =>
		Effect.gen(function* () {
			const view = mount({ entry: "/p/test/plugin-1?keep=1&dialog=open" });
			const bridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
			const initialNavigation = yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(
				bridge.messages[0],
			);
			bridge.port.postMessage({
				mode: "push",
				type: "navigate",
				target: {
					search: "q=x",
					path: "/entries",
					kind: "plugin-route",
					packageId: "test/plugin-2",
				},
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.pathname).toBe("/p/test/plugin-2/entries")),
			);
			expect(view.router.state.location.state.ryotEntryKey).toEqual(expect.any(String));
			expect(view.router.state.location.state.ryotEntryKey).not.toBe(initialNavigation.key);

			view.unmount();
			const searchView = mount({ entry: "/p/test/plugin-1?keep=1&dialog=open" });
			const searchBridge = connectFrame(
				yield* Effect.promise(() => screen.findByTitle<HTMLIFrameElement>("Fixture plugin")),
			);
			yield* Effect.promise(() => waitFor(() => expect(searchBridge.messages).toHaveLength(1)));
			const initialSearch = yield* Schema.decodeUnknownEffect(PluginBridgeLocation)(
				searchBridge.messages[0],
			);
			searchBridge.port.postMessage({
				mode: "replace",
				type: "page-search",
				update: { q: "sample", dialog: null },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(searchView.router.state.location.searchStr).toBe("?keep=1&q=sample")),
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
				screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
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
					entitySchemaSlug: "unit",
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
				entitySchemaSlug: EntitySchemaSlug.make("unit"),
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
				entry: "/p/test/plugin-1/missing",
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

const ryotqlRows =
	(
		rows: (query: string) => ReadonlyArray<Readonly<Record<string, unknown>>>,
	): RyotQLApi["Service"]["execute"] =>
	(_scope, request) =>
		Effect.succeed({
			data: Object.fromEntries(
				Object.keys(request.payload.queries).map((name) => [
					name,
					{
						items: rows(name),
						type: "rows" as const,
						pageInfo: { limit: 30, hasMore: false, nextCursor: null },
					},
				]),
			),
		});

const membershipResponse = (properties: Record<string, unknown>) => ({
	warnings: [],
	memberOf: {
		properties,
		relationshipSchemaPluginId: null,
		createdAt: "2026-10-20T00:00:00.000Z",
		id: RelationshipId.make("membership-1"),
		sourceEntityId: EntityId.make("unit-1"),
		targetEntityId: EntityId.make("collection-1"),
		relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
	},
});

const favoritesHeader = {
	name: "Favorites",
	entityId: "collection-1",
	properties: {
		membershipFields: [{ key: "notes", type: "text", label: "Notes", required: false }],
	},
};

const openPluginFrame = (view: ReturnType<typeof mount>) =>
	Effect.gen(function* () {
		const frame = yield* Effect.promise(() =>
			screen.findByTitle<HTMLIFrameElement>("Fixture plugin"),
		);
		const bridge = connectFrame(frame);
		yield* Effect.promise(() => waitFor(() => expect(bridge.messages).toHaveLength(1)));
		return { view, frame, bridge };
	});

const screenResult = (bridge: ReturnType<typeof connectFrame>, type: string, value: unknown) =>
	Effect.promise(() =>
		waitFor(() =>
			expect(bridge.messages).toContainEqual({
				type,
				value,
				outcome: "success",
				requestId: "screen-1",
			}),
		),
	);

describe("collection host screens", () => {
	it.live("creates a collection with member fields from a plugin request", () =>
		Effect.gen(function* () {
			const created: unknown[] = [];
			const { view, frame, bridge } = yield* openPluginFrame(
				mount({
					entry: "/p/test/plugin-1/details/one",
					collections: {
						create: (_scope, request) => {
							created.push(request.payload);
							return Effect.succeed(collectionResponse("collection-2", request.payload.name));
						},
					},
				}),
			);
			const loadsBefore = view.getNavigationLoads();
			bridge.port.postMessage({ requestId: "screen-1", type: "edit-collection-screen" });

			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "New collection" }),
			);
			expect(frame.hasAttribute("inert")).toBe(true);
			fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
				target: { value: " Reading " },
			});
			fireEvent.click(within(dialog).getByRole("button", { name: "Add field" }));
			fireEvent.change(within(dialog).getByRole("textbox", { name: "Label" }), {
				target: { value: "Mood" },
			});
			fireEvent.click(within(dialog).getByRole("button", { name: "Create collection" }));

			yield* screenResult(bridge, "edit-collection-screen-result", {
				kind: "saved",
				collectionId: "collection-2",
			});
			expect(created).toEqual([
				{ name: "Reading", fields: [{ type: "text", label: "Mood", required: false }] },
			]);
			expect(view.getNavigationLoads()).toBeGreaterThan(loadsBefore);
			yield* Effect.promise(() => waitFor(() => expect(frame.hasAttribute("inert")).toBe(false)));
		}),
	);

	it.live("keeps the editor open with a name error when the name is taken", () =>
		Effect.gen(function* () {
			const { bridge } = yield* openPluginFrame(
				mount({
					entry: "/p/test/plugin-1/details/one",
					collections: {
						create: () =>
							Effect.fail(
								new AuthenticatedApiError({
									cause: new CollectionBadRequest({
										reason: { field: "name", code: "name-taken" },
									}),
								}),
							),
					},
				}),
			);
			bridge.port.postMessage({ requestId: "screen-1", type: "edit-collection-screen" });
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "New collection" }),
			);
			fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), {
				target: { value: "Favorites" },
			});
			fireEvent.click(within(dialog).getByRole("button", { name: "Create collection" }));

			yield* Effect.promise(() =>
				within(dialog).findByText("You already have a collection with this name."),
			);
			expect(
				bridge.messages.some(
					(message) =>
						typeof message === "object" &&
						message !== null &&
						"type" in message &&
						message.type === "edit-collection-screen-result",
				),
			).toBe(false);
		}),
	);

	it.live("deletes an existing collection only after the kernel confirmation", () =>
		Effect.gen(function* () {
			const deleted: unknown[] = [];
			const { bridge } = yield* openPluginFrame(
				mount({
					entry: "/p/test/plugin-1/details/one",
					ryotql: ryotqlRows((query) => (query === "collection" ? [favoritesHeader] : [])),
					collections: {
						delete: (_scope, request) => {
							deleted.push(request.payload);
							return Effect.succeed({ warnings: [], id: request.payload.collectionId });
						},
					},
				}),
			);
			bridge.port.postMessage({
				requestId: "screen-1",
				collectionId: "collection-1",
				type: "edit-collection-screen",
			});
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Edit Favorites" }),
			);
			expect(within(dialog).getByRole("textbox", { name: "Label" })).toHaveProperty(
				"value",
				"Notes",
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete collection" }));
			expect(deleted).toEqual([]);
			const confirmation = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Delete Favorites?" }),
			);
			fireEvent.click(within(confirmation).getByRole("button", { name: "Delete collection" }));

			yield* screenResult(bridge, "edit-collection-screen-result", { kind: "deleted" });
			expect(deleted).toEqual([{ collectionId: "collection-1" }]);
		}),
	);

	it.live("edits and removes an existing membership's details", () =>
		Effect.gen(function* () {
			const saved: unknown[] = [];
			const removed: unknown[] = [];
			const view = mount({
				entry: "/p/test/plugin-1/details/one",
				ryotql: ryotqlRows((query) => {
					if (query === "collection") {
						return [favoritesHeader];
					}
					return query === "membership" ? [{ properties: { rank: -1, notes: "Old" } }] : [];
				}),
				collections: {
					createMembership: (_scope, request) => {
						saved.push(request.payload);
						return Effect.succeed(membershipResponse({ notes: "New" }));
					},
					deleteMembership: (_scope, request) => {
						removed.push(request.payload);
						return Effect.succeed(membershipResponse({ notes: "New" }));
					},
				},
			});
			const { bridge } = yield* openPluginFrame(view);
			const request = {
				entityId: "unit-1",
				collectionId: "collection-1",
				type: "add-to-collection-screen",
			};
			bridge.port.postMessage({ ...request, requestId: "screen-1" });
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Details in Favorites" }),
			);
			const notes = yield* Effect.promise(() =>
				waitFor(() => {
					const field = within(dialog).getByRole("textbox", { name: "Notes" });
					expect(field).toHaveProperty("value", "Old");
					return field;
				}),
			);
			fireEvent.change(notes, { target: { value: "New" } });
			fireEvent.click(within(dialog).getByRole("button", { name: "Save details" }));
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Done" })));
			yield* screenResult(bridge, "add-to-collection-screen-result", { kind: "saved" });
			expect(saved).toEqual([
				{ entityId: "unit-1", collectionId: "collection-1", properties: { notes: "New" } },
			]);

			bridge.port.postMessage({ ...request, requestId: "screen-2" });
			const reopened = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Details in Favorites" }),
			);
			fireEvent.click(within(reopened).getByRole("button", { name: "Remove from collection" }));
			const confirmation = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Remove from Favorites?" }),
			);
			fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from collection" }));
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Done" })));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(bridge.messages).toContainEqual({
						outcome: "success",
						requestId: "screen-2",
						value: { kind: "removed" },
						type: "add-to-collection-screen-result",
					}),
				),
			);
			expect(removed).toEqual([{ entityId: "unit-1", collectionId: "collection-1" }]);
		}),
	);

	it.live("creates a collection inline from the picker and adds the entity to it", () =>
		Effect.gen(function* () {
			const added: unknown[] = [];
			let createdName: string | undefined;
			const view = mount({
				entry: "/p/test/plugin-1/details/one",
				ryotql: ryotqlRows((query) =>
					query === "collection" && createdName !== undefined
						? [{ properties: {}, name: createdName, entityId: "collection-2" }]
						: [],
				),
				collections: {
					createMembership: (_scope, request) => {
						added.push(request.payload);
						return Effect.succeed(membershipResponse({}));
					},
					create: (_scope, request) => {
						createdName = request.payload.name;
						return Effect.succeed(collectionResponse("collection-2", request.payload.name));
					},
				},
			});
			const { bridge } = yield* openPluginFrame(view);
			bridge.port.postMessage({
				entityId: "unit-1",
				requestId: "screen-1",
				type: "add-to-collection-screen",
			});
			const picker = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Collections" }),
			);
			yield* Effect.promise(() => within(picker).findByText("You have no collections yet."));
			fireEvent.change(within(picker).getByRole("textbox", { name: "Search collections" }), {
				target: { value: "Units" },
			});
			fireEvent.click(within(picker).getByRole("button", { name: "Create “Units” and add" }));
			const editor = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "New collection" }),
			);
			expect(within(editor).getByRole("textbox", { name: "Name" })).toHaveProperty(
				"value",
				"Units",
			);
			fireEvent.click(within(editor).getByRole("button", { name: "Create collection" }));
			const membership = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Add to Units" }),
			);
			fireEvent.click(within(membership).getByRole("button", { name: "Add to collection" }));
			fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Done" })));

			yield* screenResult(bridge, "add-to-collection-screen-result", { kind: "saved" });
			expect(added).toEqual([
				{ properties: {}, entityId: "unit-1", mode: "add-if-absent", collectionId: "collection-2" },
			]);
		}),
	);
});
