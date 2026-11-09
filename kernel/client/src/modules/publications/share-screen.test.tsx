import { expect } from "bun:test";

import { EntityId, PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { ServerOrigin } from "#/api/origin";
import { makePublicationsApi } from "#/api/ports.test-layer";
import { mountHostedTestScreen } from "#/host-screen.test-support";

import { ShareSheet } from "./share-screen";

const serverUrl = ServerOrigin.make("https://ryot.example");
const collectionId = EntityId.make("collection-1");
const source = { collectionId, kind: "collection" } as const;
const rowsPage = { limit: 20, hasMore: false, nextCursor: null };

const publication = (linkRevokedAt: null | string) => ({
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
				label: "Shared link",
				lastExchangedAt: null,
				revokedAt: linkRevokedAt,
				createdAt: "2026-11-01T00:00:00.000Z",
			},
		],
	},
});

const mountSheet = () => {
	const requests: unknown[] = [];
	let published = false;
	let revoked = false;
	const view = mountHostedTestScreen(
		<ShareSheet source={source} disabled={false} serverUrl={serverUrl} onClose={() => undefined} />,
		{
			serverUrl,
			query: (document) =>
				Effect.succeed({
					data:
						"publications" in document.queries
							? {
									publications: {
										type: "rows",
										pageInfo: rowsPage,
										items: published
											? [publication(revoked ? "2026-11-02T00:00:00.000Z" : null)]
											: [],
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
			layer: makePublicationsApi({
				status: () => Effect.succeed({ itemCount: 3, status: "ready" as const }),
				revokeLink: (_scope, request) =>
					Effect.sync(() => {
						requests.push(request.payload);
						revoked = true;
					}),
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
		},
	);
	return { ...view, requests };
};

it.live(
	"publishes a collection with its name, keeps the new link on screen, and revokes a link after confirmation",
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
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Revoke" })),
				);
				const confirmation = yield* Effect.promise(() =>
					screen.findByRole("dialog", { name: "Revoke this link?" }),
				);
				expect(view.requests).toHaveLength(2);
				fireEvent.click(within(confirmation).getByRole("button", { name: "Revoke link" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.queryByRole("dialog", { name: "Revoke this link?" })).toBeNull(),
					),
				);
				expect(view.requests.at(-1)).toEqual({ linkId: "link-1" });
				yield* Effect.promise(() => view.advance("5 seconds"));
				yield* Effect.promise(() => screen.findByText("Revoked"));
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);
