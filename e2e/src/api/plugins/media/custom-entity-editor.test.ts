import type { ContractPayload } from "@ryot-app/contract/client";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	findRelationshipBySchema,
	getEntity,
} from "~/fixtures/kernel";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { assertCondition, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

type EditorRequest = ContractPayload<"entities", "saveEditor"> & {
	readonly submission: Extract<
		ContractPayload<"entities", "saveEditor">["submission"],
		{ readonly action: "save" }
	>;
};

describe("custom Media editor", () => {
	it.live(
		"derives missing years through API creation and editor updates, preserves explicit years, and replays saves",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema } = yield* findMediaEntitySchema(client, "movie");
				const name = `Dated custom movie ${crypto.randomUUID()}`;
				const created = yield* createEntity(client, {
					name,
					entitySchema: schema.reference,
					properties: { description: "Keep this", publishDate: "2024-02-29" },
				});
				expect(created.properties).toMatchObject({ publishYear: 2024, publishDate: "2024-02-29" });
				const entity = yield* getEntity(client, created.id);
				const request: EditorRequest = {
					submittedAt: nowIso(),
					idempotencyKey: crypto.randomUUID(),
					submission: {
						name,
						action: "save",
						relationships: [],
						entitySchema: schema.reference,
						properties: { description: "Keep this", publishDate: "2026-10-26" },
						target: {
							kind: "update",
							entityId: entity.id,
							expected: {
								name,
								relationships: [],
								updatedAt: entity.updatedAt,
								properties: entity.properties,
							},
						},
					},
				};
				const first = yield* client.call((c) => c.entities.saveEditor({ payload: request }));
				expect(first.output).toEqual({ kind: "saved", entityId: entity.id });
				expect(
					(yield* client.call((c) => c.entities.saveEditor({ payload: request }))).output,
				).toEqual(first.output);
				const updated = yield* getEntity(client, entity.id);
				expect(updated.properties).toEqual({
					publishYear: 2026,
					description: "Keep this",
					publishDate: "2026-10-26",
				});
				const explicit: EditorRequest = {
					submittedAt: nowIso(),
					idempotencyKey: crypto.randomUUID(),
					submission: {
						...request.submission,
						properties: { ...updated.properties, publishDate: "2030-01-01" },
						target: {
							kind: "update",
							entityId: entity.id,
							expected: {
								name,
								relationships: [],
								updatedAt: updated.updatedAt,
								properties: updated.properties,
							},
						},
					},
				};
				expect(
					(yield* client.call((c) => c.entities.saveEditor({ payload: explicit }))).output,
				).toEqual({ kind: "saved", entityId: entity.id });
				expect((yield* getEntity(client, entity.id)).properties).toEqual({
					...updated.properties,
					publishDate: "2030-01-01",
				});
				expect(
					(yield* client.call((c) =>
						c.entities.saveEditor({ payload: { ...request, idempotencyKey: crypto.randomUUID() } }),
					)).output,
				).toEqual({ kind: "stale" });
			}),
	);

	it.live(
		"rejects stale outgoing links and foreign ownership, then saves against a fresh baseline",
		() =>
			Effect.gen(function* () {
				const owner = yield* createAuthenticatedClient();
				const other = yield* createAuthenticatedClient();
				const { schema } = yield* findMediaEntitySchema(owner.client, "movie");
				const { schema: genreSchema } = yield* findMediaEntitySchema(owner.client, "genre");
				const movie = yield* createEntity(owner.client, {
					properties: {},
					entitySchema: schema.reference,
					name: `Custom movie ${crypto.randomUUID()}`,
				});
				const genre = yield* createEntity(owner.client, {
					properties: {},
					entitySchema: genreSchema.reference,
					name: `Custom genre ${crypto.randomUUID()}`,
				});
				const empty = [{ targets: [], relationshipSchemaSlug: "movie-to-genre" }];
				const request: EditorRequest = {
					submittedAt: nowIso(),
					idempotencyKey: crypto.randomUUID(),
					submission: {
						action: "save",
						relationships: empty,
						name: `${movie.name} edited`,
						properties: movie.properties,
						entitySchema: schema.reference,
						target: {
							kind: "update",
							entityId: movie.id,
							expected: {
								name: movie.name,
								relationships: empty,
								updatedAt: movie.updatedAt,
								properties: movie.properties,
							},
						},
					},
				};
				yield* createRelationship(owner.client, {
					properties: {},
					sourceEntityId: movie.id,
					targetEntityId: genre.id,
					relationshipSchema: {
						owner: schema.reference.owner,
						slug: RelationshipSchemaSlug.make("movie-to-genre"),
					},
				});
				expect(
					(yield* owner.client.call((c) => c.entities.saveEditor({ payload: request }))).output,
				).toEqual({ kind: "stale" });
				expect((yield* getEntity(owner.client, movie.id)).name).toBe(movie.name);
				assertTaggedError(
					yield* other.client
						.call((c) => c.entities.saveEditor({ payload: request }))
						.pipe(Effect.flip),
					"EntityNotFound",
				);
				const fresh: EditorRequest = {
					...request,
					idempotencyKey: crypto.randomUUID(),
					submission: {
						...request.submission,
						target: {
							kind: "update",
							entityId: movie.id,
							expected: {
								name: movie.name,
								updatedAt: movie.updatedAt,
								properties: movie.properties,
								relationships: [
									{
										relationshipSchemaSlug: "movie-to-genre",
										targets: [{ properties: {}, entityId: genre.id }],
									},
								],
							},
						},
					},
				};
				expect(
					(yield* owner.client.call((c) => c.entities.saveEditor({ payload: fresh }))).output,
				).toEqual({ kind: "saved", entityId: movie.id });
				expect(
					(yield* owner.client.call((c) => c.entities.saveEditor({ payload: fresh }))).output,
				).toEqual({ kind: "saved", entityId: movie.id });
			}),
	);

	it.live("edits credits from the media editor and no longer from creators", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const [{ schema }, { schema: personSchema }] = yield* Effect.all([
				findMediaEntitySchema(client, "movie"),
				findMediaEntitySchema(client, "person"),
			]);
			const person = yield* createEntity(client, {
				properties: {},
				entitySchema: personSchema.reference,
				name: `Custom person ${crypto.randomUUID()}`,
			});
			const credit = { order: 1, roles: ["Director"], character: "Narrator" };
			const created = yield* client.call((c) =>
				c.entities.saveEditor({
					payload: {
						submittedAt: nowIso(),
						idempotencyKey: crypto.randomUUID(),
						submission: {
							properties: {},
							action: "save",
							target: { kind: "create" },
							entitySchema: schema.reference,
							name: `Credited movie ${crypto.randomUUID()}`,
							relationships: [
								{
									relationshipSchemaSlug: "person-to-movie",
									targets: [{ properties: credit, entityId: person.id }],
								},
							],
						},
					},
				}),
			);
			assertCondition(created.output.kind === "saved", "Expected the credited movie to save");
			expect(
				yield* findRelationshipBySchema(client, {
					sourceEntityId: person.id,
					owner: schema.reference.owner,
					targetEntityId: created.output.entityId,
					relationshipSchemaSlug: "person-to-movie",
				}),
			).toEqual({
				properties: credit,
				sourceEntityId: person.id,
				targetEntityId: created.output.entityId,
			});
			const fromPerson = yield* client.call((c) =>
				c.entities.saveEditor({
					payload: {
						submittedAt: nowIso(),
						idempotencyKey: crypto.randomUUID(),
						submission: {
							action: "save",
							name: person.name,
							properties: person.properties,
							entitySchema: personSchema.reference,
							relationships: [{ targets: [], relationshipSchemaSlug: "person-to-movie" }],
							target: {
								kind: "update",
								entityId: person.id,
								expected: {
									name: person.name,
									updatedAt: person.updatedAt,
									properties: person.properties,
									relationships: [{ targets: [], relationshipSchemaSlug: "person-to-movie" }],
								},
							},
						},
					},
				}),
			);
			expect(fromPerson.output).toMatchObject({ kind: "invalid" });
		}),
	);
});
