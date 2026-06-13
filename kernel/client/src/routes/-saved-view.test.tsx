import { SavedViewId } from "@ryot-app/contract/schema/brands";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AuthenticatedApi } from "#/api/authenticated";
import { ManagedAssetResolutionError, ManagedAssetsService } from "#/modules/assets/managed-assets";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { SavedViewLoadError, SavedViewsService } from "#/modules/saved-views/service";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	ServerStub,
	catalog,
	makeAuthStub,
	makePublicApiStub,
	makeStorageStub,
	OAuthRouteStubs,
	theme,
} from "#/routes/-route-fixtures";

const entity = table("entity", "entity");
const queryDocument = document({
	items: rows(entity, {
		limit: 2,
		fields: [field("entityId", column(entity, "id")), field("title", column(entity, "name"))],
	}),
});
const card = {
	callout: null,
	overline: null,
	imageField: null,
	titleField: "title",
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;
const record = {
	sortOrder: 0,
	icon: "book",
	slug: "books",
	name: "Books",
	isBuiltin: true,
	isDisabled: false,
	pluginSlug: null,
	entitySchemaSlug: null,
	id: SavedViewId.make("view-1"),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	layouts: {
		grid: { ...card, entityIdField: "entityId", queryDocument },
		list: { ...card, entityIdField: "entityId", queryDocument },
		table: {
			queryDocument,
			imageField: null,
			entityIdField: "entityId",
			columns: [{ label: "Title", field: "title", displayKind: "text" }],
		},
	},
} as const;
const page = {
	pageInfo: { limit: 2, hasMore: true, nextCursor: "next" },
	items: [
		{
			title: "Piranesi",
			entityId: "book-1",
			callout: { displayKind: "number", value: 4.5 } as const,
			image: { type: "local", key: "covers/piranesi" } as const,
			overline: { displayKind: "text", value: "Book" } as const,
			primaryMetadata: { displayKind: "date", value: "2026-08-12" } as const,
			secondaryMetadata: { displayKind: "text", value: "Susanna Clarke" } as const,
		},
	],
};

type Load = SavedViewsService["Service"]["loadGrid"];
type Resolve = ManagedAssetsService["Service"]["resolve"];

const mountView = (loadGrid: Load, resolve: Resolve = () => Effect.succeed(new Map())) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			makeAuthStub(),
			ServerStub,
			makePublicApiStub(),
			AuthenticatedApi.layer,
			events.layer,
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			Layer.succeed(ManagedAssetsService, { resolve }),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			Layer.succeed(SavedViewsService, { loadGrid }),
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub("fixture"))),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: ["/v/books"] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router, runtime };
};

describe("saved-view route", () => {
	it("renders the decoded first grid page and all configured card slots", async () => {
		const view = mountView(() => Effect.succeed({ page, record }));
		try {
			expect(await screen.findByRole("heading", { name: "Books" })).toBeTruthy();
			expect(screen.getByText("1+ results")).toBeTruthy();
			expect(screen.getByRole("link", { name: "Open Piranesi" }).getAttribute("href")).toBe(
				"/e/book-1",
			);
			expect(screen.getByText("Book")).toBeTruthy();
			expect(screen.getByText("Susanna Clarke")).toBeTruthy();
			expect(screen.getByText("4.5")).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("uses the route not-found state for a missing record", async () => {
		const view = mountView(() => Effect.succeed(null));
		try {
			expect(await screen.findByRole("heading", { name: "Saved view not found" })).toBeTruthy();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("shows stable failure copy without exposing the internal cause", async () => {
		const view = mountView(() =>
			Effect.fail(new SavedViewLoadError({ stage: "record", cause: new Error("private detail") })),
		);
		try {
			expect(await screen.findByRole("heading", { name: "Saved view unavailable" })).toBeTruthy();
			expect(screen.queryByText("private detail")).toBeNull();
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});

	it("keeps the page usable when managed-image resolution fails", async () => {
		const view = mountView(
			() => Effect.succeed({ page, record }),
			() => Effect.fail(new ManagedAssetResolutionError({ cause: new Error("offline") })),
		);
		try {
			expect(await screen.findByRole("link", { name: "Open Piranesi" })).toBeTruthy();
			await waitFor(() => expect(screen.queryByText("offline")).toBeNull());
		} finally {
			view.unmount();
			await view.runtime.dispose();
		}
	});
});
