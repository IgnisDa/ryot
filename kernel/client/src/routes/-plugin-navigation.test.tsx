// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import { PluginBridgeInit, PluginBridgeLocation } from "@ryot-app/client-plugin-contract";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import type { EntityRouteProvenance } from "@ryot-app/ryotql-recipes/entities";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { KernelApiTestLayer } from "#/api/ports.test-layer";
import type { EntitiesService } from "#/modules/entities/service";
import { EntityRouteLoadError } from "#/modules/entities/service";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions, ArtifactSessionStaleError } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	theme,
	server,
	catalog,
	ServerStub,
	makeAuthStub,
	authenticated,
	OAuthRouteStubs,
	makeStorageStub,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	makeEntityRouteStub,
	SavedViewRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	ImportsRouteStubs,
	IntegrationRouteStubs,
	makeWorkspaceRecorder,
} from "#/routes/-route-fixtures";

const AuthStub = makeAuthStub();

const makeArtifactSessionsStub = (): ArtifactSessions["Service"] => ({
	revoke: () => Effect.void,
	renew: () => Effect.die("not used"),
	create: ({ clientArtifactHash }) =>
		Effect.succeed({
			sessionId: "session-1",
			expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
			src: `https://ryot.example/session/${clientArtifactHash}/index.html`,
		}),
});

const mountView = (
	initialEntry: string | string[],
	entries: PluginClientCatalog = catalog,
	load = () => Effect.succeed(entries),
	invoke: PluginOperationsService["Service"]["invoke"] = () => Effect.die("not used"),
	storage: ClientStorage["Service"] = makeStorageStub(),
	artifactSessions: ArtifactSessions["Service"] = makeArtifactSessionsStub(),
	loadRouteProvenance: EntitiesService["Service"]["loadRouteProvenance"] = () =>
		Effect.die("not used"),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			AuthStub,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			makeEntityRouteStub(loadRouteProvenance),
			makePublicApiStub(),
			KernelApiTestLayer,
			Layer.succeed(ArtifactSessions, artifactSessions),
			events.layer,
			Layer.succeed(PluginCatalogService, { load }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, storage)),
		),
	);
	const initialEntries = typeof initialEntry === "string" ? [initialEntry] : initialEntry;
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, events, router };
};

const mount = (initialEntry: string, entries: PluginClientCatalog = catalog) =>
	mountView(initialEntry, entries).router;

const mountBootstrap = (
	initialEntry: string | string[],
	entries: PluginClientCatalog,
	storage: ClientStorage["Service"],
) =>
	mountView(
		initialEntry,
		entries,
		() => Effect.succeed(entries),
		() => Effect.die("not used"),
		storage,
	);

const journalEntries: PluginClientCatalog = [
	catalog[0],
	{
		...catalog[0],
		sortOrder: 1,
		name: "Journal",
		slug: "journal",
		pluginId: "plugin-2",
		installationId: "installation-2",
	},
];

const frame = () => screen.getByTitle<HTMLIFrameElement>("fixture plugin");

const provenance = (pluginId: string | null): EntityRouteProvenance => ({
	entitySchemaPluginId: pluginId,
	entitySchemaSlug: EntitySchemaSlug.make("book"),
});

const mountEntityView = (
	initialEntry: string | string[],
	entries: PluginClientCatalog = catalog,
	loadRouteProvenance: EntitiesService["Service"]["loadRouteProvenance"] = () =>
		Effect.succeed(provenance("plugin-1")),
	load = () => Effect.succeed(entries),
	artifactSessions: ArtifactSessions["Service"] = makeArtifactSessionsStub(),
) =>
	mountView(
		initialEntry,
		entries,
		load,
		undefined,
		undefined,
		artifactSessions,
		loadRouteProvenance,
	);

const connectFrame = (element: HTMLIFrameElement) => {
	const messages: unknown[] = [];
	let init: PluginBridgeInit | undefined;
	let pluginPort: MessagePort | undefined;
	Object.defineProperty(element, "contentWindow", {
		configurable: true,
		value: {
			postMessage: (message: unknown, _origin: string, transfer: Transferable[]) => {
				const [transferred] = transfer;
				if (!(transferred instanceof MessagePort)) {
					throw new Error("Missing plugin port");
				}
				init = Schema.decodeUnknownSync(PluginBridgeInit)(message);
				pluginPort = transferred;
				transferred.addEventListener("message", (event) => messages.push(event.data));
				transferred.start();
			},
		},
	});
	fireEvent.load(element);
	if (init === undefined || pluginPort === undefined) {
		throw new Error("Plugin bridge did not connect");
	}
	const {
		mode: _mode,
		safeAreaTop: _safeAreaTop,
		safeAreaBottom: _safeAreaBottom,
		...ready
	} = init;
	return { init, ready, messages, pluginPort };
};

const isLocation = (message: unknown) =>
	typeof message === "object" && message !== null && "type" in message
		? message.type === "location"
		: false;

const locations = (messages: unknown[]) =>
	messages
		.filter(isLocation)
		.map((message) => Schema.decodeUnknownSync(PluginBridgeLocation)(message));

describe("plugin document title", () => {
	it("falls back to the catalog name and then tracks the published header title", async () => {
		mountView("/fixture");
		await screen.findByTitle("fixture plugin");
		const connected = connectFrame(frame());
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		await waitFor(() =>
			expect(connected.messages.some((message) => isLocation(message))).toBe(true),
		);
		const location = Schema.decodeUnknownSync(PluginBridgeLocation)(
			connected.messages.find((message) => isLocation(message)),
		);

		await waitFor(() => expect(document.title).toBe("Fixture — Ryot"));
		expect(document.querySelectorAll("#main-content")).toHaveLength(1);

		connected.pluginPort.postMessage({
			type: "header",
			index: location.index,
			key: location.key,
			header: { title: "Watchlist" },
		});
		await waitFor(() => expect(document.title).toBe("Watchlist — Ryot"));
	});
});

describe("plugin navigation", () => {
	it("resolves the plugin home directly from its global URL", async () => {
		const router = mount("/fixture");

		await waitFor(() => expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html"));
		expect(router.state.location.pathname).toBe("/fixture");
	});

	it("navigates an iframe entity target to the global entity route", async () => {
		const view = mountEntityView("/fixture");
		const connected = connectFrame(await screen.findByTitle<HTMLIFrameElement>("fixture plugin"));

		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages.some(isLocation)).toBe(true));
		connected.pluginPort.postMessage({
			mode: "push",
			type: "navigate",
			target: { kind: "entity", entityId: "entity-1" },
		});

		await waitFor(() => expect(view.router.state.location.pathname).toBe("/e/entity-1"));
		expect(view.router.state.location.pathname).not.toContain("/fixture");
	});

	it("keeps the remembered workspace as the sidebar identity on another workspace's route", async () => {
		const recorder = makeWorkspaceRecorder();
		mountView(
			"/journal",
			journalEntries,
			undefined,
			undefined,
			makeStorageStub("fixture", recorder),
		);

		await screen.findByTitle("journal plugin");
		expect(screen.getByRole("button", { name: "Fixture workspace, fixture" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/fixture");
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
		expect(recorder.setCalls).toEqual([]);
	});

	it("keeps the edge on the drawer at a workspace root the user did not choose", async () => {
		mountView(
			["/fixture", "/journal"],
			journalEntries,
			undefined,
			undefined,
			makeStorageStub("fixture"),
		);

		await screen.findByTitle("journal plugin");
		expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
	});

	it("hands the edge back when the remembered workspace sits on a plugin child route", async () => {
		mountView(
			["/fixture", "/journal/entries/1"],
			journalEntries,
			undefined,
			undefined,
			makeStorageStub("fixture"),
		);

		await screen.findByTitle("journal plugin");
		expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
	});

	it("shows no workspace identity when every workspace is disabled", async () => {
		const recorder = makeWorkspaceRecorder();
		mountView(
			"/fixture",
			catalog.map((entry) => ({ ...entry, isDisabled: true })),
			undefined,
			undefined,
			makeStorageStub("fixture", recorder),
		);

		await waitFor(() => expect(frame()).toBeTruthy());
		expect(screen.getByRole("button", { name: "No workspace, Plugin workspace" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
		expect(recorder.setCalls).toEqual([]);
	});

	it("inerts the shell content while the mobile drawer is open", async () => {
		mountView("/fixture");
		const content = await screen.findByTestId("shell-content");
		const trigger = screen.getByRole("button", { name: "Open navigation" });

		expect(content.hasAttribute("inert")).toBe(false);

		fireEvent.click(trigger);
		await screen.findByRole("dialog", { name: "Navigation" });
		expect(content.hasAttribute("inert")).toBe(true);

		fireEvent.click(screen.getByTestId("drawer-scrim"));
		await waitFor(() => expect(content.hasAttribute("inert")).toBe(false));
	});

	it("keeps the authenticated shell stable across plugin child routes", async () => {
		const view = mountView("/fixture");
		const { router } = view;
		const shell = await screen.findByTestId("authenticated-shell");
		const content = screen.getByTestId("shell-content");
		const iframe = frame();
		const connected = connectFrame(iframe);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		await waitFor(() => expect(iframe.getAttribute("class")).toContain("h-full"));

		expect(Array.from(shell.children).map((child) => child.getAttribute("data-testid"))).toEqual([
			"desktop-sidebar",
			"edge-gesture",
			"mobile-drawer",
			"shell-content",
		]);
		expect(shell.getAttribute("class")).toContain("h-dvh");
		expect(shell.getAttribute("class")).toContain("min-h-0");
		expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("hidden");
		expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("md:flex");
		expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("w-66");
		expect(screen.queryByTestId("screen-frame-bar")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
		expect(screen.getByTestId("mobile-drawer").tagName).toBe("DIV");
		expect(content.getAttribute("class")).toContain("min-h-0");
		expect(content.getAttribute("class")).toContain("min-w-0");
		expect(content.getAttribute("class")).toContain("overflow-hidden");
		expect(iframe.getAttribute("class")).toContain("h-full");
		expect(iframe.getAttribute("class")).not.toContain("h-screen");
		connected.pluginPort.postMessage({ type: "open-drawer" });
		await screen.findByRole("dialog", { name: "Navigation" });
		expect(frame()).toBe(iframe);
		fireEvent.click(screen.getByTestId("drawer-scrim"));
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
		expect(screen.getByTestId("authenticated-shell")).toBe(shell);
		expect(screen.getByTestId("shell-content")).toBe(content);
		expect(frame()).toBe(iframe);

		await router.navigate({ href: "/fixture/details/item-1" });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		expect(screen.getByTestId("authenticated-shell")).toBe(shell);
		expect(screen.getByTestId("shell-content")).toBe(content);
		expect(frame()).toBe(iframe);
		view.unmount();
	});

	it("restores a private route on a fresh load of its global URL", async () => {
		const router = mount("/fixture/details/item-1?tab=stats");

		await waitFor(() => expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html"));
		expect(router.state.location.pathname).toBe("/fixture/details/item-1");
		expect(router.state.location.searchStr).toBe("?tab=stats");
	});

	it("keeps one plugin document across pushes, Back, and Forward", async () => {
		const view = mountView("/fixture");
		const { router } = view;
		await waitFor(() => expect(frame()).toBeTruthy());
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));
		const document = frame();

		await router.navigate({ href: "/fixture/details/item-1?tab=stats" });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		expect(frame()).toBe(document);

		router.history.back();
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture"));
		expect(frame()).toBe(document);

		router.history.forward();
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		expect(frame()).toBe(document);
		expect(view.events.getSubscriptionCount()).toBe(1);
	});

	it("uses loader data without a duplicate request and refreshes on catalog events", async () => {
		let loads = 0;
		let entries = catalog;
		const view = mountView("/fixture/details/item-1?tab=stats", entries, () =>
			Effect.sync(() => {
				loads += 1;
				return entries;
			}),
		);

		await waitFor(() => expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html"));
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));
		expect(loads).toBe(1);
		expect(view.events.getSubscriptionCount()).toBe(1);
		await view.router.navigate({ href: "/fixture" });
		await view.router.navigate({ href: "/fixture/details/item-1?tab=stats" });
		const loadsBeforeEvent = loads;
		const initialFrame = frame();
		entries = [{ ...catalog[0], sourceHash: "next-source-hash" }];
		view.events.send();
		await waitFor(() => expect(loads).toBe(loadsBeforeEvent + 1));
		await waitFor(() => expect(frame()).not.toBe(initialFrame));
		expect(view.events.getSubscriptionCount()).toBe(1);
		const sourceRevisionFrame = frame();
		expect(sourceRevisionFrame.getAttribute("src")).toContain("/artifact-hash/index.html");

		entries = [{ ...entries[0], clientArtifactHash: "next-artifact-hash" }];
		view.events.send();
		await waitFor(() =>
			expect(frame().getAttribute("src")).toContain("/next-artifact-hash/index.html"),
		);
		expect(frame()).not.toBe(sourceRevisionFrame);
		expect(view.router.state.location.pathname).toBe("/fixture/details/item-1");
		expect(view.router.state.location.searchStr).toBe("?tab=stats");
	});

	it("refreshes the catalog when artifact session creation finds a stale installation", async () => {
		let loads = 0;
		const creates: Parameters<ArtifactSessions["Service"]["create"]>[0][] = [];
		mountView(
			"/fixture",
			catalog,
			() =>
				Effect.sync(() => {
					loads += 1;
					return catalog;
				}),
			undefined,
			undefined,
			{
				...makeArtifactSessionsStub(),
				create: (input) => {
					creates.push(input);
					return Effect.fail(new ArtifactSessionStaleError());
				},
			},
		);

		await waitFor(() => expect(loads).toBe(2));
		expect(creates).toEqual([
			{
				pluginSlug: "fixture",
				sourceHash: "source-hash",
				installationId: "installation-1",
				clientArtifactHash: "artifact-hash",
				scope: { serverUrl: server, userId: authenticated.user.id },
			},
		]);
	});

	it("refreshes and replaces the iframe when an operation finds a stale session", async () => {
		let loads = 0;
		let entries = catalog;
		const view = mountView(
			"/fixture",
			entries,
			() =>
				Effect.sync(() => {
					loads += 1;
					return entries;
				}),
			() => Effect.succeed({ outcome: "stale-session" } as const),
		);
		await waitFor(() => expect(frame()).toBeTruthy());
		const initialFrame = frame();
		const connected = connectFrame(initialFrame);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		entries = [{ ...catalog[0], sourceHash: "next-source-hash" }];
		connected.pluginPort.postMessage({
			input: null,
			type: "operation-request",
			requestId: "stale-operation",
			operationSlug: "stale-operation",
		});

		await waitFor(() => expect(loads).toBe(2));
		await waitFor(() => expect(frame()).not.toBe(initialFrame));
		expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html");
		await waitFor(() =>
			expect(connected.messages).toContainEqual({ reason: "disposed", type: "lifecycle-close" }),
		);
		expect(connected.messages).not.toContainEqual(
			expect.objectContaining({ requestId: "stale-operation", type: "operation-result" }),
		);

		view.unmount();
	});

	it("unmounts a removed plugin and stops stale access after a catalog refresh", async () => {
		let entries = catalog;
		let operationCalls = 0;
		const view = mountView(
			"/fixture",
			entries,
			() => Effect.succeed(entries),
			() => {
				operationCalls += 1;
				return Effect.succeed({ outcome: "success", value: null } as const);
			},
		);
		await waitFor(() => expect(frame()).toBeTruthy());
		const initialFrame = frame();
		const connected = connectFrame(initialFrame);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		connected.pluginPort.postMessage({
			input: null,
			type: "operation-request",
			requestId: "before-removal",
			operationSlug: "before-removal",
		});
		await waitFor(() => expect(operationCalls).toBe(1));

		entries = [];
		view.events.send();
		await waitFor(() => expect(screen.queryByTitle("fixture plugin")).toBeNull());
		expect(initialFrame.isConnected).toBe(false);
		expect(screen.getByRole("status").textContent).toBe("This page does not exist.");
		await waitFor(() =>
			expect(connected.messages).toContainEqual({ reason: "disposed", type: "lifecycle-close" }),
		);

		connected.pluginPort.postMessage({
			input: null,
			type: "operation-request",
			requestId: "after-removal",
			operationSlug: "after-removal",
		});
		expect(operationCalls).toBe(1);

		view.unmount();
	});

	it("keeps the catalog subscription across outlet changes and stops it on unmount", async () => {
		let unmounted = false;
		let queriedAfterUnmount = false;
		const view = mountView("/", [], () => {
			if (unmounted) {
				queriedAfterUnmount = true;
			}
			return Effect.succeed([]);
		});
		await screen.findByRole("heading", { name: "No workspaces enabled" });
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));
		await view.router.navigate({ href: "/missing" });
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe("This page does not exist."),
		);
		expect(view.events.isSubscribed()).toBe(true);
		expect(view.events.getSubscriptionCount()).toBe(1);

		view.unmount();
		unmounted = true;
		await waitFor(() => expect(view.events.isSubscribed()).toBe(false));
		view.events.send();
		expect(queriedAfterUnmount).toBe(false);
	});

	it("drops a replaced entry out of the kernel history stack", async () => {
		const router = mount("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());

		await router.navigate({ href: "/fixture/details/item-1" });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));
		await router.navigate({ href: "/fixture/details/item-2", replace: true });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-2"));

		router.history.back();

		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture"));
	});

	it("never renders a plugin for a reserved or uninstalled slug", async () => {
		mount("/settings");
		await screen.findByRole("heading", { level: 1, name: "Settings" });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();

		mount("/missing");
		await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
	});
});

describe("entity navigation", () => {
	it("shows entity loading without an iframe on a fresh pending load", async () => {
		let resolveProvenance!: (value: EntityRouteProvenance) => void;
		const pending = new Promise<EntityRouteProvenance>((resolve) => {
			resolveProvenance = resolve;
		});
		mountEntityView("/e/entity-pending", catalog, () => Effect.promise(() => pending));

		await screen.findByRole("heading", { name: "Entity loading" }, { timeout: 2_500 });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(document.querySelectorAll("main")).toHaveLength(1);

		resolveProvenance(provenance("plugin-1"));
		await screen.findByTitle("fixture plugin");
	});

	it("renders stable kernel states without mounting a plugin document", async () => {
		const missing = mountEntityView("/e/missing", catalog, () => Effect.succeed(null));
		await screen.findByRole("heading", { name: "Entity not found" });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(document.querySelectorAll("main")).toHaveLength(1);
		missing.unmount();

		const unsupported = mountEntityView("/e/kernel", catalog, () =>
			Effect.succeed(provenance(null)),
		);
		await screen.findByRole("heading", { name: "Kernel-owned entity unsupported" });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		unsupported.unmount();

		mountEntityView("/e/unavailable", catalog, () => Effect.succeed(provenance("plugin-missing")));
		await screen.findByRole("heading", { name: "Required plugin unavailable" });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
	});

	it("shows a stable route error and removes the previous plugin document", async () => {
		const view = mountEntityView("/fixture", catalog, () =>
			Effect.fail(new EntityRouteLoadError({ cause: new Error("unavailable") })),
		);
		const initialFrame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");

		await view.router.navigate({ href: "/e/entity-1" });

		await screen.findByRole("heading", { name: "Retryable entity load failure" });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(initialFrame.isConnected).toBe(false);
		expect(document.querySelectorAll("main")).toHaveLength(1);
	});

	it("selects the exact plugin ID and permits a disabled installation on a direct URL", async () => {
		const entries: PluginClientCatalog = [catalog[0], { ...journalEntries[1], isDisabled: true }];
		const creates: Parameters<ArtifactSessions["Service"]["create"]>[0][] = [];
		const artifacts = makeArtifactSessionsStub();
		mountEntityView(
			"/e/entity-2",
			entries,
			() => Effect.succeed(provenance("plugin-2")),
			undefined,
			{
				...artifacts,
				create: (input) => {
					creates.push(input);
					return artifacts.create(input);
				},
			},
		);

		await screen.findByTitle("journal plugin");
		expect(creates).toEqual([
			{
				pluginSlug: "journal",
				sourceHash: "source-hash",
				installationId: "installation-2",
				clientArtifactHash: "artifact-hash",
				scope: { serverUrl: server, userId: authenticated.user.id },
			},
		]);
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(document.querySelectorAll("main")).toHaveLength(1);
	});

	it("keeps the shell, content, iframe, and bridge across a same-owner entity transition", async () => {
		let provenanceLoads = 0;
		const view = mountEntityView("/fixture/details/item-1", catalog, () =>
			Effect.sync(() => {
				provenanceLoads += 1;
				return provenance("plugin-1");
			}),
		);
		const shell = await screen.findByTestId("authenticated-shell");
		const content = screen.getByTestId("shell-content");
		const iframe = frame();
		const connected = connectFrame(iframe);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages.some(isLocation)).toBe(true));
		const initialLocation = locations(connected.messages)[0];
		expect(initialLocation).toMatchObject({
			location: { kind: "route", path: "/details/item-1", search: "" },
		});

		await view.router.navigate({ href: "/e/entity-1" });

		await waitFor(() => expect(locations(connected.messages)).toHaveLength(2));
		const entityLocation = locations(connected.messages)[1];
		expect(
			locations(connected.messages).map(({ index, key, location }) => ({ index, key, location })),
		).toEqual([
			{
				index: initialLocation.index,
				key: initialLocation.key,
				location: { kind: "route", path: "/details/item-1", search: "" },
			},
			{
				index: initialLocation.index + 1,
				key: entityLocation.key,
				location: {
					kind: "entity",
					entityId: "entity-1",
					entitySchemaSlug: "book",
				},
			},
		]);
		expect(frame()).toBe(iframe);
		expect(screen.getByTestId("authenticated-shell")).toBe(shell);
		expect(screen.getByTestId("shell-content")).toBe(content);
		expect(document.querySelectorAll("main")).toHaveLength(1);
		expect(provenanceLoads).toBe(1);

		view.router.history.back();
		await waitFor(() =>
			expect(view.router.state.location.pathname).toBe("/fixture/details/item-1"),
		);
		await waitFor(() => expect(locations(connected.messages)).toHaveLength(3));
		expect(
			locations(connected.messages).map(({ index, key, location }) => ({ index, key, location })),
		).toEqual([
			{
				index: initialLocation.index,
				key: initialLocation.key,
				location: { kind: "route", path: "/details/item-1", search: "" },
			},
			{
				index: initialLocation.index + 1,
				key: entityLocation.key,
				location: {
					kind: "entity",
					entityId: "entity-1",
					entitySchemaSlug: "book",
				},
			},
			{
				index: initialLocation.index,
				key: initialLocation.key,
				location: { kind: "route", path: "/details/item-1", search: "" },
			},
		]);
		expect(frame()).toBe(iframe);
		expect(provenanceLoads).toBe(1);
	});

	it("keeps the committed plugin location while an entity load is pending", async () => {
		let resolveProvenance!: (value: EntityRouteProvenance) => void;
		const pending = new Promise<EntityRouteProvenance>((resolve) => {
			resolveProvenance = resolve;
		});
		const view = mountEntityView("/fixture/details/item-1", catalog, () =>
			Effect.promise(() => pending),
		);
		const iframe = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const connected = connectFrame(iframe);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages.some(isLocation)).toBe(true));
		const initialLocation = locations(connected.messages)[0];

		const navigation = view.router.navigate({ href: "/e/entity-pending" });
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/e/entity-pending"));
		expect(frame()).toBe(iframe);
		expect(locations(connected.messages)).toEqual([initialLocation]);

		resolveProvenance(provenance("plugin-1"));
		await navigation;
		await waitFor(() => expect(locations(connected.messages)).toHaveLength(2));
		const committedLocation = locations(connected.messages)[1];
		expect(
			locations(connected.messages).map(({ index, key, location }) => ({ index, key, location })),
		).toEqual([
			{
				index: initialLocation.index,
				key: initialLocation.key,
				location: { kind: "route", path: "/details/item-1", search: "" },
			},
			{
				index: initialLocation.index + 1,
				key: committedLocation.key,
				location: {
					kind: "entity",
					entityId: "entity-pending",
					entitySchemaSlug: "book",
				},
			},
		]);
		expect(frame()).toBe(iframe);
	});

	it("aborts a superseded entity load and ignores its late result", async () => {
		let resolveFirst!: (value: EntityRouteProvenance) => void;
		let firstSettled = false;
		const first = new Promise<EntityRouteProvenance>((resolve) => {
			resolveFirst = resolve;
		});
		void first.then(() => {
			firstSettled = true;
			return undefined;
		});
		const calls: Array<{ readonly entityId: string; readonly signal: AbortSignal }> = [];
		const view = mountEntityView("/fixture", journalEntries, (_client, entityId) =>
			Effect.tryPromise({
				try: (signal) => {
					calls.push({ entityId, signal });
					return entityId === "entity-a" ? first : Promise.resolve(provenance("plugin-1"));
				},
				catch: (cause) => new EntityRouteLoadError({ cause }),
			}),
		);
		const iframe = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const connected = connectFrame(iframe);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(locations(connected.messages)).toHaveLength(1));

		const firstNavigation = view.router.navigate({ href: "/e/entity-a" });
		await waitFor(() => expect(calls.map(({ entityId }) => entityId)).toEqual(["entity-a"]));
		await view.router.navigate({ href: "/e/entity-b" });

		expect(calls.map(({ entityId }) => entityId)).toEqual(["entity-a", "entity-b"]);
		expect(calls[0].signal.aborted).toBe(true);
		await waitFor(() => expect(locations(connected.messages)).toHaveLength(2));
		const messagesAfterSecondCommit = locations(connected.messages);
		expect(messagesAfterSecondCommit[1].location).toEqual({
			kind: "entity",
			entityId: "entity-b",
			entitySchemaSlug: "book",
		});

		resolveFirst(provenance("plugin-2"));
		await firstNavigation;
		await waitFor(() => expect(firstSettled).toBe(true));
		expect(locations(connected.messages)).toEqual(messagesAfterSecondCommit);
		expect(frame()).toBe(iframe);
		expect(screen.queryByTitle("journal plugin")).toBeNull();
	});

	it("replaces the plugin document when entity ownership changes", async () => {
		const view = mountEntityView("/fixture", journalEntries, () =>
			Effect.succeed(provenance("plugin-2")),
		);
		const initialFrame = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");

		await view.router.navigate({ href: "/e/entity-2" });

		const nextFrame = await screen.findByTitle<HTMLIFrameElement>("journal plugin");
		expect(nextFrame).not.toBe(initialFrame);
		expect(initialFrame.isConnected).toBe(false);
	});

	it("re-resolves the committed provenance after catalog refresh without querying it again", async () => {
		let provenanceLoads = 0;
		let entries: PluginClientCatalog = catalog;
		const view = mountEntityView(
			"/e/entity-1",
			entries,
			() =>
				Effect.sync(() => {
					provenanceLoads += 1;
					return provenance("plugin-1");
				}),
			() => Effect.succeed(entries),
		);
		await screen.findByTitle("fixture plugin");
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));

		entries = [];
		view.events.send();
		await screen.findByRole("heading", { name: "Required plugin unavailable" });
		expect(screen.queryByTitle("fixture plugin")).toBeNull();
		expect(provenanceLoads).toBe(1);

		entries = catalog;
		view.events.send();
		await screen.findByTitle("fixture plugin");
		expect(provenanceLoads).toBe(1);
	});

	it("owns the title and keeps the kernel edge on a fresh entity document", async () => {
		mountEntityView(["/v/global-view", "/e/entity-1"]);
		const iframe = await screen.findByTitle<HTMLIFrameElement>("fixture plugin");
		const connected = connectFrame(iframe);
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages.some(isLocation)).toBe(true));
		const location = Schema.decodeUnknownSync(PluginBridgeLocation)(
			connected.messages.find(isLocation),
		);

		expect(location).toMatchObject({
			edgeBack: false,
			leading: "back",
			location: { kind: "entity", entityId: "entity-1", entitySchemaSlug: "book" },
		});
		expect(screen.getByTestId("edge-gesture")).toBeTruthy();
		expect(document.title).toBe("Fixture — Ryot");
		connected.pluginPort.postMessage({
			type: "header",
			index: location.index,
			key: location.key,
			header: { title: "Entity details" },
		});
		await waitFor(() => expect(document.title).toBe("Entity details — Ryot"));
		expect(document.querySelectorAll("main")).toHaveLength(1);
	});
});

describe("desktop navigation", () => {
	it("shows workspace metadata and marks Home active only at the workspace root", async () => {
		const view = mountView("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());
		const trigger = screen.getByRole("button", { name: "Fixture workspace, fixture" });
		const home = screen.getByRole("link", { name: "Home" });

		expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.getAttribute("aria-controls")).toBeTruthy();
		expect(trigger.querySelector('[data-app-icon="puzzle"]')).not.toBeNull();
		expect(home.getAttribute("href")).toBe("/fixture");
		expect(home.getAttribute("aria-current")).toBe("page");
		expect(home.getAttribute("class")).toContain("bg-nav-indicator");

		await view.router.navigate({ href: "/fixture/details/item-1" });
		await waitFor(() =>
			expect(view.router.state.location.pathname).toBe("/fixture/details/item-1"),
		);
		expect(home.getAttribute("aria-current")).toBeNull();
		expect(home.getAttribute("class")).not.toContain("bg-nav-indicator");
	});

	it("navigates through saved views and collections loaded by the shell", async () => {
		const savedView = mountView("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());

		expect(screen.getByRole("link", { name: "Global View" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Fixture Collection" })).toBeTruthy();
		fireEvent.click(screen.getByRole("link", { name: "Global View" }));
		await waitFor(() => expect(savedView.router.state.location.pathname).toBe("/v/global-view"));
		savedView.unmount();

		const collection = mountView("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());
		fireEvent.click(screen.getByRole("link", { name: "Fixture Collection" }));
		await waitFor(() => expect(collection.router.state.location.pathname).toBe("/e/collection-1"));
	});

	it("uses the remembered workspace around settings and marks all settings paths active", async () => {
		const view = mountView(
			"/settings/account",
			catalog,
			() => Effect.succeed(catalog),
			() => Effect.die("not used"),
			makeStorageStub("fixture"),
		);
		const settings = await screen.findByRole("link", { name: "Open settings" });

		expect(screen.getByRole("button", { name: "Fixture workspace, fixture" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
		expect(settings.getAttribute("href")).toBe("/settings");
		expect(settings.getAttribute("aria-current")).toBe("page");
		expect(settings.getAttribute("class")).toContain("bg-nav-indicator");
		expect(settings.textContent).toContain("Test User");
		expect(settings.textContent).toContain("user@ryot.example");
		expect(settings.querySelector('[data-avatar="root"]')).not.toBeNull();
		expect(view.router.state.location.pathname).toBe("/settings/account");
	});

	it("closes, persists the scoped workspace, and replaces history before navigating", async () => {
		const recorder = makeWorkspaceRecorder();
		const entries: PluginClientCatalog = [
			catalog[0],
			{
				...catalog[0],
				sortOrder: 1,
				name: "Journal",
				slug: "journal",
				pluginId: "plugin-2",
				installationId: "installation-2",
			},
		];
		const view = mountView(
			["/before", "/fixture/details/item-1"],
			entries,
			() => Effect.succeed(entries),
			() => Effect.die("not used"),
			makeStorageStub("fixture", recorder),
		);
		await screen.findByRole("button", { name: "Fixture workspace, fixture" });
		fireEvent.click(screen.getByRole("button", { name: "Fixture workspace, fixture" }));

		fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Journal workspace" }));

		await waitFor(() => expect(view.router.state.location.pathname).toBe("/journal"));
		expect(recorder.setCalls).toEqual([
			{ scope: { serverUrl: server, userId: authenticated.user.id }, slug: "journal" },
		]);
		expect(recorder.popupOpenWhenSet).toEqual([false]);
		expect(screen.queryByRole("menu")).toBeNull();

		view.router.history.back();
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/before"));
	});
});

describe("authenticated root bootstrap", () => {
	const scope = { serverUrl: server, userId: authenticated.user.id };

	it("renders a stable error when workspaces cannot be loaded", async () => {
		mountView("/", catalog, () => Effect.die("catalog unavailable"));

		const alertText = await screen.findByRole("alert");
		expect(alertText.textContent).toBe("Your workspaces could not be loaded.");
	});

	it("selects a valid remembered workspace without persisting it again", async () => {
		const recorder = makeWorkspaceRecorder();
		const entries = [
			{ ...catalog[0], slug: "first", sortOrder: 0 },
			{ ...catalog[0], slug: "remembered", sortOrder: 1 },
		];
		const view = mountBootstrap("/", entries, makeStorageStub("remembered", recorder));

		await waitFor(() => expect(view.router.state.location.pathname).toBe("/remembered"));
		expect(recorder.getScopes.length).toBeGreaterThan(0);
		expect(
			recorder.getScopes.every((calledScope) => calledScope.serverUrl === scope.serverUrl),
		).toBe(true);
		expect(recorder.getScopes.every((calledScope) => calledScope.userId === scope.userId)).toBe(
			true,
		);
		expect(recorder.setCalls).toEqual([]);
	});

	it.each([null, "missing", "disabled"])(
		"persists the deterministic fallback for remembered value %s",
		async (rememberedSlug) => {
			const recorder = makeWorkspaceRecorder();
			const entries = [
				{ ...catalog[0], slug: "disabled", sortOrder: -1, isDisabled: true },
				{ ...catalog[0], slug: "zeta", sortOrder: 1 },
				{ ...catalog[0], slug: "alpha", sortOrder: 1 },
			];
			const view = mountBootstrap("/", entries, makeStorageStub(rememberedSlug, recorder));

			await waitFor(() => expect(view.router.state.location.pathname).toBe("/alpha"));
			expect(recorder.getScopes.length).toBeGreaterThan(0);
			expect(
				recorder.getScopes.every((calledScope) => calledScope.serverUrl === scope.serverUrl),
			).toBe(true);
			expect(recorder.getScopes.every((calledScope) => calledScope.userId === scope.userId)).toBe(
				true,
			);
			expect(recorder.setCalls).toEqual([{ scope, slug: "alpha" }]);
		},
	);

	it("replaces the root history entry", async () => {
		const view = mountBootstrap(["/before", "/"], catalog, makeStorageStub("fixture"));
		await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));

		view.router.history.back();

		await waitFor(() => expect(view.router.state.location.pathname).toBe("/before"));
	});

	it("renders account navigation when no workspace is enabled", async () => {
		const recorder = makeWorkspaceRecorder();
		const view = mountBootstrap(
			"/",
			catalog.map((entry) => Object.assign(entry, { isDisabled: true })),
			makeStorageStub("fixture", recorder),
		);

		await screen.findByRole("heading", { name: "No workspaces enabled" });
		expect(view.router.state.location.pathname).toBe("/");
		expect(
			screen
				.getByRole("button", { name: "No workspace, Plugin workspace" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
		expect(screen.getByRole("link", { name: "Open settings" }).textContent).toContain("Test User");
		expect(screen.getByRole("link", { name: "Account settings" }).getAttribute("href")).toBe(
			"/settings/account",
		);
		expect(recorder.getScopes.length).toBeGreaterThan(0);
		expect(recorder.setCalls).toEqual([]);
	});

	it("pops global history when the plugin document commits a back gesture", async () => {
		const view = mountView("/fixture");
		const { router } = view;
		await waitFor(() => expect(frame()).toBeTruthy());
		const connected = connectFrame(frame());
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages).toHaveLength(1));

		await router.navigate({ href: "/fixture/details/item-1" });
		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture/details/item-1"));

		connected.pluginPort.postMessage({ type: "navigate-back" });

		await waitFor(() => expect(router.state.location.pathname).toBe("/fixture"));
		view.unmount();
	});

	it("hands the edge to the plugin document only on a child route it can pop", async () => {
		const view = mountView("/fixture");
		const { router } = view;
		await waitFor(() => expect(frame()).toBeTruthy());
		const connected = connectFrame(frame());
		connected.pluginPort.postMessage(connected.ready);
		await waitFor(() => expect(connected.messages).toHaveLength(1));

		expect(connected.messages).toContainEqual(
			expect.objectContaining({ edgeBack: false, type: "location" }),
		);
		expect(screen.getByTestId("edge-gesture")).toBeTruthy();

		await router.navigate({ href: "/fixture/details/item-1" });

		await waitFor(() =>
			expect(connected.messages).toContainEqual(
				expect.objectContaining({ edgeBack: false, leading: "back", type: "location" }),
			),
		);
		const childLocation = Schema.decodeUnknownSync(PluginBridgeLocation)(connected.messages.at(-1));
		connected.pluginPort.postMessage({
			type: "screen-state",
			index: childLocation.index,
			key: childLocation.key,
			hasPreviousScreen: true,
		});
		await waitFor(() =>
			expect(connected.messages).toContainEqual(
				expect.objectContaining({ edgeBack: true, type: "location" }),
			),
		);
		expect(screen.queryByTestId("edge-gesture")).toBeNull();
		view.unmount();
	});
});
