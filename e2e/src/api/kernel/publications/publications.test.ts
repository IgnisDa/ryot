import { PUBLICATION_SESSION_HEADER } from "@ryot-app/contract/modules/publications/schemas";
import { column, document, field, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	type Client,
	createAuthenticatedClient,
	createCollection,
	getApiClient,
	requireRows,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const subject = table("entity", "subject");
const subjectIds = document({
	subjects: rows(subject, { fields: [field("id", column(subject, "id"))] }),
});

const publishCollection = (client: Client) =>
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
					icon: "book",
					title: "Shelf",
					description: null,
					showOwnerName: true,
					source: { kind: "collection", collectionId: shelf.id },
				},
			}),
		);
		const link = yield* client.call((c) =>
			c.publications.createLink({ payload: { publicationId, expiresAt: null, label: "Friends" } }),
		);
		return { link, member, outsider, publicationId };
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
			).toEqual({ itemCount: 1, status: "ready" });

			const page = yield* visitor.call((c) => c.publicationVisits.page(), headers);
			expect(page.publication).toMatchObject({ itemCount: 1, publicationId, title: "Shelf" });
			expect(page.publication.ownerName).not.toBeNull();
			expect(page.context.target).toEqual({ publicationId, kind: "publication" });

			const result = yield* visitor.call(
				(c) => c.publicationVisits.ryotql({ payload: subjectIds }),
				headers,
			);
			expect(requireRows(result.data["subjects"], "subjects").items).toEqual([{ id: member.id }]);

			yield* client.call((c) => c.publications.revokeLink({ payload: { linkId: link.linkId } }));
			const error = yield* Effect.flip(
				visitor.call((c) => c.publicationVisits.ryotql({ payload: subjectIds }), headers),
			);
			assertTaggedError(error, "PublicationUnavailable");
			expect(error.reason).toEqual({ code: "revoked" });
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
