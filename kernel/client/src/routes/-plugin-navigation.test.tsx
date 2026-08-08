// oxlint-disable unicorn/require-post-message-target-origin -- MessagePort has no target origin
import {
	PluginBridgeInit,
	PluginThemeSnapshot,
	REQUIRED_THEME_TOKEN_NAMES,
} from "@ryot/contract/modules/plugins/client";
import type { PluginClientCatalog } from "@ryot/ryotql-recipes/plugin-client-catalog";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { PublicApi } from "#/api/public";
import { AuthClient } from "#/modules/auth/client";
import { AuthService } from "#/modules/auth/service";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ServerService } from "#/modules/server/service";
import type { ThemeStore } from "#/modules/theme/store";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";

const server = "https://ryot.example";
const theme: ThemeStore = {
	destroy: () => undefined,
	getPreference: () => "system",
	setPreference: () => undefined,
	subscribe: () => () => undefined,
	getSnapshot: () =>
		Schema.decodeUnknownSync(PluginThemeSnapshot)({
			resolvedMode: "light",
			tokens: Object.fromEntries(REQUIRED_THEME_TOKEN_NAMES.map((name) => [name, name])),
		}),
};

const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		icon: "puzzle",
		name: "Fixture",
		health: "ready",
		slug: "fixture",
		isDisabled: false,
		clientApiVersion: 1,
		pluginId: "plugin-1",
		sourceHash: "source-hash",
		installationId: "installation-1",
		clientArtifactHash: "artifact-hash",
	},
];

const StorageStub = Layer.succeed(ClientStorage, {
	remove: () => Effect.void,
	clearServerSelection: Effect.void,
	setLastWorkspace: () => Effect.void,
	setServerSelection: () => Effect.void,
	setThemePreference: () => Effect.void,
	getServerSelection: Effect.succeed(server),
	getLastWorkspace: () => Effect.succeed(null),
	getThemePreference: Effect.succeed("system" as const),
});

const ServerStub = Layer.succeed(ServerService, {
	connect: () => Effect.void,
	selected: Effect.succeed(server),
});

const AuthStub = Layer.succeed(AuthService, {
	signOut: () => Effect.void,
	changeServer: () => Effect.void,
	signInWithOidc: () => Effect.void,
	verifyTwoFactor: () => Effect.void,
	settledSession: () => Effect.succeed(authenticated),
	submitCredentials: () => Effect.succeed({ _tag: "Authenticated" } as const),
	session: () => ({ subscribe: () => () => undefined, getSnapshot: () => authenticated }),
});

const authenticated = {
	status: "authenticated",
	user: { id: "user-1", email: "user@ryot.example" },
} as const;

const mountView = (
	initialEntry: string,
	entries: PluginClientCatalog = catalog,
	load = () => Effect.succeed(entries),
	invoke: PluginOperationsService["Service"]["invoke"] = () => Effect.die("not used"),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			AuthStub,
			ServerStub,
			PublicApi.layer,
			AuthClient.layer,
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(PluginCatalogService, { load }),
			Layer.succeed(PluginOperationsService, { invoke }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(Layer.provideMerge(StorageStub)),
	);
	const router = getRouter(
		{ runtime, theme },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, events, router };
};

const mount = (initialEntry: string, entries: PluginClientCatalog = catalog) =>
	mountView(initialEntry, entries).router;

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

	it("stops catalog queries when the plugin destination unmounts", async () => {
		let unmounted = false;
		let queriedAfterUnmount = false;
		const view = mountView("/fixture", catalog, () => {
			if (unmounted) {
				queriedAfterUnmount = true;
			}
			return Effect.succeed(catalog);
		});
		await waitFor(() => expect(frame()).toBeTruthy());
		await waitFor(() => expect(view.events.isSubscribed()).toBe(true));

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
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe("This page does not exist."),
		);
		expect(screen.queryByTitle("fixture plugin")).toBeNull();

		mount("/missing");
		await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2));
	});
});
