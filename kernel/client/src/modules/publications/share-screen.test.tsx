import { expect } from "bun:test";

import { EntityId, PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import { createTestRyotClock } from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, ManagedRuntime } from "effect";

import { ServerOrigin } from "#/api/origin";
import { makePublicationsApi } from "#/api/ports.test-layer";
import { testHostServices } from "#/host-services.test-support";

import { ShareSheet } from "./share-screen";

const serverUrl = ServerOrigin.make("https://ryot.example");
const collectionId = EntityId.make("collection-1");
const source = { collectionId, kind: "collection" } as const;
const rowsPage = { limit: 20, hasMore: false, nextCursor: null };

const publication = {
	source,
	revision: 1,
	icon: "library",
	revokedAt: null,
	description: null,
	title: "Road trips",
	id: "publication-1",
	showOwnerName: false,
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z",
	links: {
		pageInfo: { limit: 100, hasMore: false },
		items: [
			{
				id: "link-1",
				expiresAt: null,
				revokedAt: null,
				label: "Shared link",
				lastExchangedAt: null,
				createdAt: "2026-11-01T00:00:00.000Z",
			},
		],
	},
};

const mountSheet = () => {
	const requests: unknown[] = [];
	let published = false;
	const runtime = ManagedRuntime.make(
		makePublicationsApi({
			status: () => Effect.succeed({ itemCount: 3, status: "ready" as const }),
			createLink: (_scope, request) =>
				Effect.sync(() => {
					requests.push(request.payload);
					return { secret: "secret-1", linkId: PublicationLinkId.make("link-1") };
				}),
			create: (_scope, request) =>
				Effect.sync(() => {
					requests.push(request.payload);
					published = true;
					return { revision: 1, publicationId: PublicationId.make("publication-1") };
				}),
		}),
	);
	const clock = createTestRyotClock({
		query: (document) =>
			Effect.succeed({
				data:
					"publications" in document.queries
						? {
								publications: {
									type: "rows",
									pageInfo: rowsPage,
									items: published ? [publication] : [],
								},
							}
						: {
								collection: {
									type: "rows",
									pageInfo: rowsPage,
									items: [{ properties: {}, name: "Road trips", entityId: collectionId }],
								},
							},
			}),
	});
	const root = createRootRoute({ component: Outlet });
	const sheet = createRoute({
		path: "/",
		getParentRoute: () => root,
		component: () => (
			<ShareSheet
				source={source}
				disabled={false}
				serverUrl={serverUrl}
				onClose={() => undefined}
			/>
		),
	});
	const router = createRouter({
		routeTree: root.addChildren([sheet]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const view = render(
		<RyotProvider
			runtime={clock.runtime}
			hostServices={testHostServices({ serverUrl, userId: "user-1" }, runtime)}
		>
			<RouterProvider router={router} />
		</RyotProvider>,
	);
	return {
		requests,
		advance: clock.advance,
		dispose: () => {
			view.unmount();
			return Effect.runPromise(Effect.all([runtime.disposeEffect, Effect.promise(clock.dispose)]));
		},
	};
};

it.live(
	"publishes a collection with its name, keeps the new link on screen, and then shows its links",
	() =>
		Effect.gen(function* () {
			const view = mountSheet();
			try {
				const title = yield* Effect.promise(() => screen.findByRole("textbox", { name: "Title" }));
				expect(title).toHaveProperty("value", "Road trips");
				fireEvent.click(screen.getByRole("button", { name: "Publish and create link" }));

				const link = yield* Effect.promise(() =>
					screen.findByRole("textbox", { name: "New link" }),
				);
				expect(link).toHaveProperty("value", "https://ryot.example/share/publication-1#secret-1");
				expect(view.requests).toEqual([
					{ source, icon: "library", description: null, title: "Road trips", showOwnerName: false },
					{ expiresAt: null, label: "Shared link", publicationId: "publication-1" },
				]);

				yield* Effect.promise(() => view.advance("5 seconds"));
				yield* Effect.promise(() => screen.findByText("3 items"));
				expect(screen.getByRole("textbox", { name: "New link" })).toBeDefined();
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined()),
				);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);
