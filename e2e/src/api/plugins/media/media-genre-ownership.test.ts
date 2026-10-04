import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEntity } from "~/fixtures/kernel/entities";
import { findMediaEntitySchema } from "~/fixtures/plugins/media/entity-schemas";
import { createGlobalBookEntityFixture } from "~/fixtures/plugins/media/media";
import { assertTaggedError } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";

it.live("allows custom-media genres but rejects personal genre overrides on provider media", () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { schema: genreSchema } = yield* findMediaEntitySchema(client, "genre");
		const genre = yield* createEntity(client, {
			properties: {},
			entitySchema: genreSchema.reference,
			name: `Private Genre ${crypto.randomUUID()}`,
		});
		const { schema: bookSchema, entity: providerBook } =
			yield* createGlobalBookEntityFixture(client);
		const book = yield* createEntity(client, {
			properties: {},
			entitySchema: bookSchema.reference,
			name: `Custom Book ${crypto.randomUUID()}`,
		});
		const relationshipSchema = {
			owner: bookSchema.reference.owner,
			slug: RelationshipSchemaSlug.make("book-to-genre"),
		};
		const custom = yield* client.call((c) =>
			c.relationships.create({
				payload: {
					properties: {},
					relationshipSchema,
					sourceEntityId: book.id,
					targetEntityId: genre.id,
				},
			}),
		);
		expect(custom.relationship?.sourceEntityId).toBe(book.id);
		const error = yield* Effect.flip(
			client.call((c) =>
				c.relationships.create({
					payload: {
						properties: {},
						relationshipSchema,
						targetEntityId: genre.id,
						sourceEntityId: providerBook.id,
					},
				}),
			),
		);
		assertTaggedError(error, "RelationshipBadRequest");
		expect(error.reason).toMatchObject({
			code: "source-not-owned",
			sourceEntityId: providerBook.id,
		});
	}),
);
