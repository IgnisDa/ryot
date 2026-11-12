import { PUBLICATION_SESSION_HEADER } from "@ryot-app/contract/modules/publications/schemas";
import { encodeEntitySourceReference } from "@ryot-app/contract/modules/ryotql/entity-source";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Schema } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createCollection,
	getApiClient,
	installPrivatePlugin,
	requireRows,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { webRequest } from "~/support/web-request";

const publishCollection = (client: Client, mode: "live" | "snapshot" = "live") =>
	Effect.gen(function* () {
		const shelf = yield* createCollection(client, { name: "Shelf" });
		const member = yield* createCollection(client, { name: "Member" });
		const outsider = yield* createCollection(client, { name: "Outsider" });
		yield* client.call((c) =>
			c.collections.createMembership({ payload: { entityId: member.id, collectionId: shelf.id } }),
		);
		const { publicationId } = yield* client.call((c) =>
			c.publications.create({
				payload: {
					mode,
					icon: "book",
					title: "Shelf",
					description: null,
					showOwnerName: true,
					page: { kind: "kernel", name: "publication" },
					arguments: {
						source: encodeEntitySourceReference({ kind: "collection", collectionId: shelf.id }),
					},
				},
			}),
		);
		const link = yield* client.call((c) =>
			c.publications.createLink({ payload: { publicationId, expiresAt: null, label: "Friends" } }),
		);
		return { link, shelf, member, outsider, publicationId };
	});

describe("publications", () => {
	it.live("lets an anonymous visitor read only the published entities until revoked", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { link, member, publicationId } = yield* publishCollection(client);
			const visitor = getApiClient();

			const session = yield* visitor.call((c) =>
				c.publicationVisits.exchange({ payload: { publicationId, secret: link.secret } }),
			);
			const headers = { [PUBLICATION_SESSION_HEADER]: session.sessionToken };

			expect(
				yield* client.call((c) => c.publications.status({ payload: { publicationId } })),
			).toEqual({ status: "ready" });

			const page = yield* visitor.call((c) => c.publicationVisits.page(), headers);
			expect(page.publication).toMatchObject({ itemCount: 1, publicationId, title: "Shelf" });
			expect(page.publication.ownerName).not.toBeNull();
			expect(page.context.target).toEqual({ publicationId, kind: "publication" });

			const result = yield* visitor.call(
				(c) => c.publicationVisits.ryotql({ payload: { query: "items" } }),
				headers,
			);
			expect(
				requireRows(result.data["items"], "items").items.map((item) => item["__entityBrowserId"]),
			).toEqual([member.id]);

			const inline = yield* webRequest(`${client.target.apiUrl}/publications/visit/ryotql`, {
				method: "POST",
				headers: { ...headers, "content-type": "application/json" },
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					source: { kind: "inline", document: { queries: {} } },
				}),
			});
			expect(inline.status).toBe(400);

			const overridden = yield* visitor.call(
				(c) =>
					c.publicationVisits.ryotql({
						payload: {
							query: "items",
							arguments: {
								source: encodeEntitySourceReference({
									kind: "collection",
									collectionId: member.id,
								}),
							},
						},
					}),
				headers,
			);
			expect(
				requireRows(overridden.data["items"], "items").items.map(
					(item) => item["__entityBrowserId"],
				),
			).toEqual([member.id]);
			const undeclared = yield* Effect.flip(
				visitor.call(
					(c) => c.publicationVisits.ryotql({ payload: { query: "undeclared" } }),
					headers,
				),
			);
			assertTaggedError(undeclared, "RyotQLBadRequest");
			expect(undeclared.reason).toMatchObject({ code: "invalid-query" });

			yield* client.call((c) => c.publications.revokeLink({ payload: { linkId: link.linkId } }));
			const error = yield* Effect.flip(
				visitor.call((c) => c.publicationVisits.ryotql({ payload: { query: "items" } }), headers),
			);
			assertTaggedError(error, "PublicationUnavailable");
			expect(error.reason).toEqual({ code: "revoked" });
		}),
	);

	it.live("refreshes a snapshot by replacing captured results", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { link, shelf, member, outsider, publicationId } = yield* publishCollection(
				client,
				"snapshot",
			);
			const visitor = getApiClient();
			const session = yield* visitor.call((c) =>
				c.publicationVisits.exchange({ payload: { publicationId, secret: link.secret } }),
			);
			const headers = { [PUBLICATION_SESSION_HEADER]: session.sessionToken };
			yield* client.call((c) =>
				c.collections.createMembership({
					payload: { entityId: outsider.id, collectionId: shelf.id },
				}),
			);
			const before = yield* visitor.call(
				(c) => c.publicationVisits.ryotql({ payload: { query: "items" } }),
				headers,
			);
			expect(
				requireRows(before.data["items"], "items").items.map((item) => item["__entityBrowserId"]),
			).toEqual([member.id]);
			yield* client.call((c) =>
				c.publications.republish({
					payload: {
						icon: "book",
						publicationId,
						title: "Shelf",
						mode: "snapshot",
						description: null,
						showOwnerName: true,
						page: { kind: "kernel", name: "publication" },
						arguments: {
							source: encodeEntitySourceReference({ kind: "collection", collectionId: shelf.id }),
						},
					},
				}),
			);
			const after = yield* visitor.call(
				(c) => c.publicationVisits.ryotql({ payload: { query: "items" } }),
				headers,
			);
			expect(
				requireRows(after.data["items"], "items").items.map((item) => item["__entityBrowserId"]),
			).toEqual(sortBy([member.id, outsider.id]));
			expect(requireRows(after.data["items"], "items").items).toHaveLength(2);
		}),
	);

	it.live("never authenticates a visitor session as the owner", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { link, publicationId } = yield* publishCollection(client);
			const visitor = getApiClient();
			const session = yield* visitor.call((c) =>
				c.publicationVisits.exchange({ payload: { publicationId, secret: link.secret } }),
			);
			const error = yield* Effect.flip(
				visitor.call((c) => c.collections.create({ payload: { name: "Intruder" } }), {
					[PUBLICATION_SESSION_HEADER]: session.sessionToken,
				}),
			);
			assertTaggedError(error, "AuthUnauthorized");
		}),
	);

	it.live("refuses to publish a page depending on a private plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({ client, config: { greeting: "private" } });
			const page = yield* client.call((api) =>
				api.pageAuthoring.create({
					payload: {
						name: "Private dependency",
						slug: `private-${crypto.randomUUID()}`,
						definition: {
							entry: "client/page.tsx",
							queries: { queries: {} },
							pluginDependencies: {
								dependency: { scope: "user", packageId: plugin.manifest.metadata.packageId },
							},
							files: [
								{
									path: "client/page.tsx",
									content: Buffer.from(
										"export default function Page() { return <h2>Private</h2>; }",
									).toString("base64"),
								},
							],
						},
					},
				}),
			);
			yield* client.call((api) =>
				api.pageAuthoring.publish({ payload: { pageId: page.pageId, expectedDraftRevision: 1 } }),
			);
			const error = yield* Effect.flip(
				client.call((api) =>
					api.publications.create({
						payload: {
							icon: "book",
							mode: "live",
							arguments: {},
							title: "Private",
							description: null,
							showOwnerName: false,
							page: { kind: "page", pageId: page.pageId },
						},
					}),
				),
			);
			assertTaggedError(error, "PublicationBadRequest");
			expect(error.reason).toMatchObject({ code: "dependency-unavailable" });
		}),
	);

	it.live("refuses an unknown secret", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { publicationId } = yield* publishCollection(client);
			const error = yield* Effect.flip(
				getApiClient().call((c) =>
					c.publicationVisits.exchange({ payload: { publicationId, secret: "x".repeat(43) } }),
				),
			);
			assertTaggedError(error, "PublicationUnavailable");
			expect(error.reason).toEqual({ code: "not-found" });
		}),
	);
});
