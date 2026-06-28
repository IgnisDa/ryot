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
import { ClientPageSessions } from "#/modules/client-pages/sessions";
import { EntitiesService } from "#/modules/entities/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
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
					entitySchemaSlug: EntitySchemaSlug.make("book"),
					entitySchemaPluginId: pluginId,
				}
			: target;
	return {
		identity: {
			target,
			pluginId,
			exportName: "page",
			kind: "plugin-page",
			buildId: `build-${pluginId}`,
			graphHash: `graph-${pluginId}`,
			sourceHash: `source-${pluginId}`,
			artifactHash: `artifact-${pluginId}`,
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
		context: {
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
		},
	};
};

const preparedSavedView = (savedViewId: SavedViewId): PreparedClientPage => {
	const prepared = preparedFor({
		path: "/",
		search: "",
		kind: "plugin-route",
		pluginId: "plugin-1",
	});
	return {
		...prepared,
		context: { ...prepared.context, target: { kind: "saved-view", savedViewId } },
		identity: {
			savedViewId,
			viewRevision: 1,
			kind: "kernel-saved-view",
			rendererName: "dashboard",
			sourceHash: "source-plugin-1",
			buildId: prepared.identity.buildId,
			graphHash: prepared.identity.graphHash,
			target: { kind: "saved-view", savedViewId },
			artifactHash: prepared.identity.artifactHash,
			contributors: prepared.identity.contributors,
			operationTargets: prepared.identity.operationTargets,
		},
	};
};

function mount(options: {
	readonly entry: string;
	readonly entries?: PluginClientCatalog;
	readonly prepare?: ClientPagesApi["Service"]["prepare"];
	readonly renew?: ClientPageSessions["Service"]["renew"];
}) {
	const targets: ClientPageTarget[] = [];
	const sessions: PreparedClientPage["identity"][] = [];
	const operations: Parameters<PluginOperationsService["Service"]["invoke"]>[0][] = [];
	const prepare: ClientPagesApi["Service"]["prepare"] =
		options.prepare ??
		((_scope, request) => {
			targets.push(request.payload.target);
			const target = request.payload.target;
			if (target.kind === "saved-view") {
				return Effect.succeed(preparedSavedView(target.savedViewId));
			}
			const pluginId = target.kind === "plugin-route" ? target.pluginId : "plugin-1";
			return Effect.succeed(preparedFor(target, pluginId));
		});
	const entries = options.entries ?? catalog;
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			Layer.succeed(EntitiesService, { loadRouteProvenance: () => Effect.die("not used") }),
			makePublicApiStub(),
			KernelApiTestLayer,
			events.layer,
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(entries) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(ClientPagesApi, {
				prepare,
				renewSession: () => Effect.die("not used"),
				revokeSession: () => Effect.die("not used"),
				createSession: () => Effect.die("not used"),
			}),
			Layer.succeed(ClientPageSessions, {
				create: (_scope, identity) => {
					sessions.push(identity);
					return Effect.succeed({
						sessionId: `session-${sessions.length}`,
						expiresAt: new Date(Date.now() + 600_000).toISOString(),
						src: `https://artifacts.example/${identity.artifactHash}/index.html`,
					});
				},
				renew: options.renew ?? (() => Effect.die("not used")),
				revoke: () => Effect.void,
			}),
			Layer.succeed(PluginOperationsService, {
				invoke: (input) => {
					operations.push(input);
					return Effect.succeed({ outcome: "success", value: null });
				},
			}),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub("fixture"))),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [options.entry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, events, operations, router, sessions, targets };
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
	const { mode: _mode, page: _page, safeAreaTop: _top, safeAreaBottom: _bottom, ...ready } = init;
	port.postMessage(ready);
	return { init, messages, port };
}

const preparationFailure = (reason: ClientPagePreparationError["reason"]) =>
	Effect.fail(new AuthenticatedApiError({ cause: new ClientPagePreparationError({ reason }) }));

describe("client page routes", () => {
	it("renders the selected home view at the active workspace URL through one page host", async () => {
		const savedViewId = SavedViewId.make("home-view-1");
		const view = mount({
			entry: "/fixture",
			entries: [{ ...catalog[0], homeSavedViewId: savedViewId }],
		});
		const frame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const bridge = connectFrame(frame);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		expect(view.targets).toEqual([{ kind: "saved-view", savedViewId }]);
		expect(view.router.state.location.pathname).toBe("/fixture");
		expect(screen.getByRole("button", { name: "Fixture workspace, fixture" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
		expect(globalThis.document.querySelectorAll("iframe")).toHaveLength(1);
		expect(globalThis.document.querySelectorAll("main")).toHaveLength(1);
		expect(
			globalThis.document.querySelectorAll('[data-testid="authenticated-shell"]'),
		).toHaveLength(1);
		expect(Schema.decodeUnknownSync(PluginBridgeLocation)(bridge.messages[0])).toMatchObject({
			location: { kind: "route", path: "/fixture", search: "" },
		});
	});

	it("uses the normal plugin home route when no override is selected", async () => {
		const view = mount({ entry: "/fixture" });
		await screen.findByTitle("fixture plugin");

		expect(view.targets).toEqual([
			{ kind: "plugin-route", pluginId: "plugin-1", path: "/", search: "" },
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
		expect(targets).toEqual([{ kind: "saved-view", savedViewId }]);
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
		expect(targets).toEqual([{ kind: "saved-view", savedViewId }]);
		expect(screen.queryByTitle(/plugin$/)).toBeNull();
	});

	it("prepares an ordinary plugin route and mounts the shared page session", async () => {
		const view = mount({ entry: "/fixture/details/one?tab=stats" });
		const frame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const bridge = connectFrame(frame);
		await waitFor(() => expect(bridge.messages).toHaveLength(1));

		expect(view.targets).toEqual([
			{ kind: "plugin-route", pluginId: "plugin-1", path: "/details/one", search: "tab=stats" },
		]);
		expect(view.sessions).toHaveLength(1);
		expect(Schema.decodeUnknownSync(PluginBridgeLocation)(bridge.messages[0])).toMatchObject({
			location: { kind: "route", path: "/details/one", search: "tab=stats" },
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
			request: { pluginSlug: "fixture", operationSlug: "greet", input: null },
		});
		expect(view.operations[1]).toMatchObject({
			sourceHash: "operations-only-source",
			request: { pluginSlug: "operations-only", operationSlug: "mutate", input: null },
		});
	});

	it("adopts changed operation targets only after an explicit update reload", async () => {
		let preparation = 0;
		const view = mount({
			entry: "/fixture/details/one",
			renew: () => Effect.succeed({ outcome: "replace", reason: "stale" }),
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
					identity: {
						...prepared.identity,
						operationTargets,
					},
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
		await waitFor(() => expect(view.operations).toHaveLength(1));
		expect(view.operations[0]).toMatchObject({ sourceHash: "operations-only-source" });

		act(() => view.events.send());
		await screen.findByText("An update is available. Reloading will discard unsaved local state.");
		fireEvent.click(screen.getByRole("button", { name: "Reload updated page" }));
		await waitFor(() => expect(preparation).toBe(3));
		const reloadedFrame = await waitFor(() => {
			const frame = screen.getByTitle<HTMLIFrameElement>("fixture plugin");
			expect(frame).not.toBe(firstFrame);
			return frame;
		});
		expect(view.sessions).toHaveLength(2);
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
		await waitFor(() => expect(view.operations).toHaveLength(3));
		expect(view.operations[1]).toMatchObject({ sourceHash: "operations-only-updated" });
		expect(view.operations[2]).toMatchObject({ sourceHash: "newly-installed-source" });
	});

	it("uses explicit plugin navigation and merges page search with null deletion", async () => {
		const view = mount({ entry: "/fixture?keep=1&dialog=open" });
		const bridge = connectFrame(await screen.findByTitle("fixture plugin"));
		await waitFor(() => expect(bridge.messages).toHaveLength(1));
		bridge.port.postMessage({
			mode: "push",
			type: "navigate",
			target: { kind: "plugin-route", pluginSlug: "journal", path: "/entries", search: "q=x" },
		});
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/journal/entries"));

		view.unmount();
		const searchView = mount({ entry: "/fixture?keep=1&dialog=open" });
		const searchBridge = connectFrame(
			await screen.findByTitle<HTMLIFrameElement>("fixture plugin"),
		);
		await waitFor(() => expect(searchBridge.messages).toHaveLength(1));
		searchBridge.port.postMessage({
			mode: "replace",
			type: "page-search",
			update: { dialog: null, q: "dune" },
		});
		await waitFor(() => expect(searchView.router.state.location.searchStr).toBe("?keep=1&q=dune"));
	});

	it("prepares entities directly and allows a disabled ready installation", async () => {
		const entries = [{ ...catalog[0], isDisabled: true }];
		const view = mount({ entry: "/e/entity-1?tab=activity", entries });
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

	it("renders an unregistered plugin page without starting a session", async () => {
		const view = mount({
			entry: "/fixture/missing",
			prepare: () =>
				preparationFailure({
					path: "/missing",
					pluginId: "plugin-1",
					code: "plugin-route-not-registered",
				}),
		});
		await screen.findByRole("heading", { name: "Plugin page not found" });
		expect(view.sessions).toEqual([]);
	});
});
