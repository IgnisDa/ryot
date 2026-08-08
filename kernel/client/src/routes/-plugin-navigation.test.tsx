// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import { PluginBridgeInit } from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { AuthClient } from "#/modules/auth/client";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	ServerStub,
	authenticated,
	catalog,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStub,
	makeWorkspaceRecorder,
	server,
	theme,
} from "#/routes/-route-fixtures";

const AuthStub = makeAuthStub();

const mountView = (
	initialEntry: string | string[],
	entries: PluginClientCatalog = catalog,
	load = () => Effect.succeed(entries),
	invoke: PluginOperationsService["Service"]["invoke"] = () => Effect.die("not used"),
	storage: ClientStorage["Service"] = makeStorageStub(),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			AuthStub,
			ServerStub,
			makePublicApiStub(),
			AuthClient.layer,
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(PluginCatalogService, { load }),
			Layer.succeed(PluginOperationsService, { invoke }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(Layer.provideMerge(Layer.succeed(ClientStorage, storage))),
	);
	const initialEntries = typeof initialEntry === "string" ? [initialEntry] : initialEntry;
	const router = getRouter({ runtime, theme }, createMemoryHistory({ initialEntries }));
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

const frame = () => screen.getByTitle<HTMLIFrameElement>("fixture plugin");

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
	return { init, messages, pluginPort };
};

describe("plugin navigation", () => {
	it("resolves the plugin home directly from its global URL", async () => {
		const router = mount("/fixture");

		await waitFor(() => expect(frame().getAttribute("src")).toContain("/artifact-hash/index.html"));
		expect(router.state.location.pathname).toBe("/fixture");
	});

	it("remembers an enabled workspace opened by its direct route", async () => {
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
		mountView("/journal", entries, undefined, undefined, makeStorageStub("fixture", recorder));

		await waitFor(() =>
			expect(recorder.setCalls).toEqual([
				{ slug: "journal", scope: { serverUrl: server, userId: authenticated.user.id } },
			]),
		);
	});

	it("does not remember a disabled workspace opened by its direct route", async () => {
		const recorder = makeWorkspaceRecorder();
		mountView(
			"/fixture",
			catalog.map((entry) => ({ ...entry, isDisabled: true })),
			undefined,
			undefined,
			makeStorageStub(null, recorder),
		);

		await waitFor(() => expect(frame()).toBeTruthy());
		expect(recorder.setCalls).toEqual([]);
	});

	it("keeps a disabled direct-route workspace as the sidebar identity", async () => {
		mount(
			"/fixture",
			catalog.map((entry) => ({ ...entry, isDisabled: true })),
		);

		await waitFor(() => expect(frame()).toBeTruthy());
		expect(screen.getByRole("button", { name: "Fixture workspace, fixture" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
	});

	it("keeps the authenticated shell stable across plugin child routes", async () => {
		const view = mountView("/fixture");
		const { router } = view;
		const shell = await screen.findByTestId("authenticated-shell");
		const content = screen.getByTestId("shell-content");
		const iframe = frame();
		const connected = connectFrame(iframe);
		connected.pluginPort.postMessage(connected.init);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		connected.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
		await waitFor(() => expect(iframe.getAttribute("class")).toContain("h-full"));

		expect(Array.from(shell.children).map((child) => child.getAttribute("data-testid"))).toEqual([
			"desktop-sidebar",
			"mobile-header",
			"mobile-drawer",
			"shell-content",
		]);
		expect(shell.getAttribute("class")).toContain("h-dvh");
		expect(shell.getAttribute("class")).toContain("min-h-0");
		expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("hidden");
		expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("md:flex");
		expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("w-66");
		expect(screen.getByTestId("mobile-header").getAttribute("class")).toContain(
			"safe-area-inset-top",
		);
		expect(screen.getByTestId("mobile-header").getAttribute("class")).toContain("md:hidden");
		expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
		expect(screen.getByTestId("mobile-drawer").tagName).toBe("DIALOG");
		expect(within(screen.getByTestId("mobile-header")).getByText("Fixture")).toBeTruthy();
		expect(within(screen.getByTestId("mobile-header")).getByText("fixture")).toBeTruthy();
		expect(content.getAttribute("class")).toContain("min-h-0");
		expect(content.getAttribute("class")).toContain("min-w-0");
		expect(content.getAttribute("class")).toContain("overflow-hidden");
		expect(iframe.getAttribute("class")).toContain("h-full");
		expect(iframe.getAttribute("class")).not.toContain("h-screen");
		const mobileTrigger = screen.getByRole("button", { name: "Open navigation" });

		fireEvent.click(mobileTrigger);
		await screen.findByRole("dialog", { name: "Navigation" });
		expect(mobileTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(frame()).toBe(iframe);
		fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
		await waitFor(() => expect(mobileTrigger.getAttribute("aria-expanded")).toBe("false"));
		expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
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
		connected.pluginPort.postMessage(connected.init);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		connected.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
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
		connected.pluginPort.postMessage(connected.init);
		await waitFor(() => expect(connected.messages).toHaveLength(1));
		connected.pluginPort.postMessage({ generation: 1, type: "theme-applied" });
		await waitFor(() => expect(connected.messages).toHaveLength(2));
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

describe("desktop navigation", () => {
	it("shows workspace metadata and marks Home active only at the workspace root", async () => {
		const view = mountView("/fixture");
		await waitFor(() => expect(frame()).toBeTruthy());
		const trigger = screen.getByRole("button", { name: "Fixture workspace, fixture" });
		const home = screen.getByRole("link", { name: "Home" });

		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
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
});
