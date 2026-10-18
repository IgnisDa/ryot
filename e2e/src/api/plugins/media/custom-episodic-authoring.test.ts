import type { ContractPayload } from "@ryot-app/contract/client";
import { EntityId, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { mediaActivityLogContextRecipe } from "@ryot-app/media-plugin/shared/activity-log-recipes";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntity,
	createRelationship,
	executeRyotQL,
	executeRyotQLRecipe,
	getEntity,
	pollUntil,
	requireRows,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import {
	findMediaEntitySchema,
	logMediaActivity,
	mediaReferenceForEntity,
	queryInMediaLibraryRelationship,
	seedShow,
} from "~/fixtures/plugins/media";
import { assertCondition, assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

type SchemaReference = Submission["entitySchema"];
type Submission = ContractPayload<"entities", "saveEditor">["submission"];

const submit = (client: Client, submission: Submission) =>
	client.call((c) =>
		c.entities.saveEditor({
			payload: { submission, submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() },
		}),
	);

const parentGroup = (relationshipSchemaSlug: string, parentId: string) => [
	{ relationshipSchemaSlug, targets: [{ properties: {}, entityId: EntityId.make(parentId) }] },
];

const createChild = Effect.fnUntraced(function* (
	client: Client,
	input: {
		name: string;
		parentId: string;
		entitySchema: SchemaReference;
		relationshipSchemaSlug: string;
		properties: Record<string, unknown>;
	},
) {
	const result = yield* submit(client, {
		action: "save",
		name: input.name,
		target: { kind: "create" },
		properties: input.properties,
		entitySchema: input.entitySchema,
		relationships: parentGroup(input.relationshipSchemaSlug, input.parentId),
	});
	assertCondition(result.output.kind === "saved", `Expected ${input.name} to save`);
	return result.output.entityId;
});

const customShowTree = Effect.fnUntraced(function* (client: Client) {
	const [show, season, episode] = yield* Effect.all([
		findMediaEntitySchema(client, "show"),
		findMediaEntitySchema(client, "show-season"),
		findMediaEntitySchema(client, "show-episode"),
	]);
	const showEntity = yield* createEntity(client, {
		properties: {},
		entitySchema: show.schema.reference,
		name: `Custom show ${crypto.randomUUID()}`,
	});
	const seasonId = yield* createChild(client, {
		name: "Season 1",
		parentId: showEntity.id,
		properties: { seasonNumber: 1 },
		entitySchema: season.schema.reference,
		relationshipSchemaSlug: "show-to-show-season",
	});
	const episodeIds = yield* Effect.forEach([1, 2], (episodeNumber) =>
		createChild(client, {
			parentId: seasonId,
			name: `Episode ${episodeNumber}`,
			entitySchema: episode.schema.reference,
			properties: { episodeNumber, seasonNumber: 1 },
			relationshipSchemaSlug: "show-season-to-show-episode",
		}),
	);
	return {
		seasonId,
		episodeIds,
		show: showEntity,
		seasonSchema: season.schema.reference,
		episodeSchema: episode.schema.reference,
	};
});

const nextUpOf = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const reference = yield* mediaReferenceForEntity(client, entityId);
		const context = yield* executeRyotQLRecipe(
			client,
			mediaActivityLogContextRecipe({ entityId, reference }),
		);
		return context?.nextUp?.id ?? null;
	});

const entityExists = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entity = table("entity", "entity");
		const result = yield* executeRyotQL(
			client,
			document({
				entity: rows(entity, {
					limit: 1,
					fields: [field("id", column(entity, "id"))],
					where: eq(column(entity, "id"), literal(entityId)),
				}),
			}),
		);
		return requireRows(result.data.entity, "entity").items.length === 1;
	});

const deleteRequest = (entitySchema: SchemaReference, entityId: string, updatedAt: string) => ({
	entitySchema,
	action: "delete" as const,
	expectedUpdatedAt: updatedAt,
	entityId: EntityId.make(entityId),
});

describe("custom Media seasons and episodes", () => {
	it.live(
		"authors children under owned shows, tracks them, fixes their parent and season, and refuses provider parents",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const tree = yield* customShowTree(client);
				const [first, second] = tree.episodeIds;
				assertCondition(first !== undefined && second !== undefined, "Expected two episodes");

				const seasonMembership = yield* queryInMediaLibraryRelationship(
					client,
					tree.seasonId,
					"show-season",
				);
				expect(
					seasonMembership.data.entity?.type === "rows" ? seasonMembership.data.entity.items : [],
				).toEqual([]);
				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						kind: "episodes",
						when: { kind: "now" },
						episodeEntityIds: [first],
						parentEntityId: tree.show.id,
					},
				});
				expect(
					yield* pollUntil(
						"custom next-up",
						nextUpOf(client, tree.show.id).pipe(
							Effect.map((nextUp) => (nextUp === second ? nextUp : null)),
						),
					),
				).toBe(second);

				const season = yield* getEntity(client, tree.seasonId);
				const seasonParent = parentGroup("show-to-show-season", tree.show.id);
				expect(
					(yield* submit(client, {
						action: "save",
						name: season.name,
						relationships: seasonParent,
						entitySchema: tree.seasonSchema,
						properties: { ...season.properties, seasonNumber: 2 },
						target: {
							kind: "update",
							entityId: season.id,
							expected: {
								name: season.name,
								relationships: seasonParent,
								updatedAt: season.updatedAt,
								properties: season.properties,
							},
						},
					})).output,
				).toMatchObject({ kind: "invalid" });

				const otherSeasonId = yield* createChild(client, {
					name: "Season 2",
					parentId: tree.show.id,
					properties: { seasonNumber: 2 },
					entitySchema: tree.seasonSchema,
					relationshipSchemaSlug: "show-to-show-season",
				});
				const episode = yield* getEntity(client, second);
				expect(
					(yield* submit(client, {
						action: "save",
						name: episode.name,
						properties: episode.properties,
						entitySchema: tree.episodeSchema,
						relationships: parentGroup("show-season-to-show-episode", otherSeasonId),
						target: {
							kind: "update",
							entityId: episode.id,
							expected: {
								name: episode.name,
								updatedAt: episode.updatedAt,
								properties: episode.properties,
								relationships: parentGroup("show-season-to-show-episode", tree.seasonId),
							},
						},
					})).output,
				).toMatchObject({ kind: "invalid" });

				const provider = yield* seedShow(client, {
					inLibrary: false,
					seasons: [{ episodes: [], seasonNumber: 1 }],
				});
				expect(
					(yield* submit(client, {
						action: "save",
						name: "Intruding season",
						target: { kind: "create" },
						properties: { seasonNumber: 9 },
						entitySchema: tree.seasonSchema,
						relationships: parentGroup("show-to-show-season", provider.show.id),
					})).output,
				).toMatchObject({ kind: "invalid" });
				const providerSeason = provider.seasons[0];
				assertCondition(providerSeason !== undefined, "Expected a provider season");
				assertTaggedError(
					yield* createRelationship(client, {
						properties: {},
						targetEntityId: EntityId.make(second),
						sourceEntityId: EntityId.make(providerSeason.id),
						relationshipSchema: {
							owner: tree.seasonSchema.owner,
							slug: RelationshipSchemaSlug.make("show-season-to-show-episode"),
						},
					}).pipe(Effect.flip),
					"RelationshipBadRequest",
				);
			}),
	);

	it.live("deletes only children without history or remaining children", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const { client } = owner;
			const tree = yield* customShowTree(client);
			const [watched, unwatched] = tree.episodeIds;
			assertCondition(watched !== undefined && unwatched !== undefined, "Expected two episodes");
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: crypto.randomUUID(),
				entry: {
					kind: "episodes",
					when: { kind: "now" },
					episodeEntityIds: [watched],
					parentEntityId: tree.show.id,
				},
			});
			const remove = (entitySchema: SchemaReference, entityId: string) =>
				Effect.gen(function* () {
					const entity = yield* getEntity(client, entityId);
					return yield* submit(client, deleteRequest(entitySchema, entityId, entity.updatedAt));
				});

			expect((yield* remove(tree.episodeSchema, watched)).output).toMatchObject({
				kind: "invalid",
			});
			expect((yield* remove(tree.seasonSchema, tree.seasonId)).output).toMatchObject({
				kind: "invalid",
			});
			const target = yield* getEntity(client, unwatched);
			assertTaggedError(
				yield* submit(
					other.client,
					deleteRequest(tree.episodeSchema, unwatched, target.updatedAt),
				).pipe(Effect.flip),
				"EntityNotFound",
			);
			const payload = {
				submittedAt: nowIso(),
				idempotencyKey: crypto.randomUUID(),
				submission: deleteRequest(tree.episodeSchema, unwatched, target.updatedAt),
			};
			const replayDelete = client.call((c) => c.entities.saveEditor({ payload }));
			expect((yield* replayDelete).output).toEqual({ kind: "deleted" });
			expect((yield* replayDelete).output).toEqual({ kind: "deleted" });
			expect(yield* entityExists(client, unwatched)).toBe(false);
			expect(yield* entityExists(client, watched)).toBe(true);
		}),
	);
});
