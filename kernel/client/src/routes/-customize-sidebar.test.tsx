import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import type { CustomizeSidebarService } from "#/modules/navigation/customize/service";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	ServerStub,
	OAuthRouteStubs,
	GodModeRouteStubs,
	SavedViewRouteStubs,
	ProviderAddRouteStubs,
	NavigationRouteStubs,
	theme,
	catalog,
	makeAuthStub,
	makeStorageStub,
	makeCustomizeStub,
	makePublicApiStub,
} from "#/routes/-route-fixtures";

type SavedPlan = Parameters<CustomizeSidebarService["Service"]["save"]>[1];

const mountView = (initialEntry: string, saves: SavedPlan[] = []) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			makeAuthStub(),
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			makePublicApiStub(),
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			NavigationRouteStubs,
			makeCustomizeStub((_scope, plan) =>
				Effect.sync(() => {
					saves.push(plan);
				}),
			),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub("fixture"))),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

const stubMatchMedia = (desktop: boolean) => {
	const original = window.matchMedia;
	window.matchMedia = ((query: string) => ({
		media: query,
		onchange: null,
		dispatchEvent: () => false,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		matches: desktop && query === "(min-width: 768px)",
	})) as typeof window.matchMedia;
	return () => {
		window.matchMedia = original;
	};
};

const openPanel = async () => {
	const sidebar = await screen.findByTestId("desktop-sidebar");
	return within(sidebar);
};

describe("customize sidebar route", () => {
	it("turns the desktop sidebar into the customize panel and drops the nav and account footer", async () => {
		const restore = stubMatchMedia(true);
		try {
			mountView("/customize-sidebar");
			const panel = await openPanel();

			expect(
				panel.getByText("Reorder and choose which views appear in your sidebar."),
			).toBeDefined();
			expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
			expect(screen.getByTestId("desktop-sidebar").getAttribute("class")).toContain("w-100");
		} finally {
			restore();
		}
	});

	it("renders no mobile header or drawer over the customize screen", async () => {
		const restore = stubMatchMedia(false);
		try {
			mountView("/customize-sidebar");
			await screen.findByRole("button", { name: "Cancel sidebar customization" });

			expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
			expect(screen.queryByTestId("mobile-drawer")).toBeNull();
		} finally {
			restore();
		}
	});

	it("opens on the section named in the search params", async () => {
		const restore = stubMatchMedia(true);
		try {
			const view = mountView("/customize-sidebar?section=savedViews");
			await openPanel();

			expect(view.router.state.location.search.section).toBe("savedViews");
		} finally {
			restore();
		}
	});

	it("leaves without asking while the draft is clean", async () => {
		const restore = stubMatchMedia(true);
		try {
			const view = mountView("/customize-sidebar");
			const panel = await openPanel();

			fireEvent.click(panel.getByRole("button", { name: "Cancel sidebar customization" }));

			await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
			expect(screen.queryByText("Discard sidebar changes?")).toBeNull();
		} finally {
			restore();
		}
	});

	it("asks before discarding a dirty draft and stays put while editing continues", async () => {
		const restore = stubMatchMedia(true);
		try {
			const view = mountView("/customize-sidebar");
			const panel = await openPanel();

			fireEvent.click(panel.getByRole("switch", { name: "Show Fixture View in sidebar" }));
			fireEvent.click(panel.getByRole("button", { name: "Cancel sidebar customization" }));

			await screen.findByRole("dialog", { name: "Discard sidebar changes?" });
			fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

			await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
			expect(view.router.state.location.pathname).toBe("/customize-sidebar");
		} finally {
			restore();
		}
	});

	// A load started while still on the customize route is the bug the ordering exists to prevent:
	// the navigation that follows aborts it, so the sidebar keeps rendering the order just changed.
	it("starts no load until it has left, so the navigation cannot abort the refresh", async () => {
		const restore = stubMatchMedia(true);
		try {
			const view = mountView("/customize-sidebar");
			const panel = await openPanel();
			const loadedAt: string[] = [];
			view.router.subscribe("onBeforeLoad", () =>
				loadedAt.push(view.router.latestLocation.pathname),
			);

			fireEvent.click(panel.getByRole("switch", { name: "Show Fixture View in sidebar" }));
			fireEvent.click(panel.getByRole("button", { name: "Save sidebar changes" }));

			await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
			expect(loadedAt).not.toContain("/customize-sidebar");
			expect(loadedAt).toContain("/fixture");
		} finally {
			restore();
		}
	});

	it("saves the plan and leaves once the save succeeds", async () => {
		const restore = stubMatchMedia(true);
		const saves: SavedPlan[] = [];
		try {
			const view = mountView("/customize-sidebar", saves);
			const panel = await openPanel();

			fireEvent.click(panel.getByRole("switch", { name: "Show Fixture View in sidebar" }));
			fireEvent.click(panel.getByRole("button", { name: "Save sidebar changes" }));

			await waitFor(() => expect(view.router.state.location.pathname).toBe("/fixture"));
			expect(saves).toHaveLength(1);
			expect(saves[0]?.updates.map((update) => update.viewSlug)).toEqual(["fixture-view"]);
		} finally {
			restore();
		}
	});
});
