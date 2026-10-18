import type { ContractPayload } from "@ryot-app/contract/client";
import { EntityId, pluginPackageSegments } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import { type Client, createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createCollection } from "~/fixtures/kernel/collections";
import { createEntity, getEntity } from "~/fixtures/kernel/entities";
import { createEventFixture } from "~/fixtures/kernel/entity-graph";
import { clearEntityUserData, mergeEntityUserData } from "~/fixtures/kernel/entity-user-data";
import { listEventSchemas, requireEventSchemaBySlug } from "~/fixtures/kernel/event-schemas";
import { listEventsForEntity, waitForEventCount } from "~/fixtures/kernel/events";
import {
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel/relationship-schemas";
import { createRelationship, findRelationshipBySchema } from "~/fixtures/kernel/relationships";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { logMediaActivity } from "~/fixtures/plugins/media/activity-log";
import { findMediaEntitySchema } from "~/fixtures/plugins/media/entity-schemas";
import { settledHistoryCorrection } from "~/fixtures/plugins/media/history-correction";
import {
	insertLibraryMembership,
	insertMediaMonitoring,
	queryInMediaLibraryRelationship,
	seedMediaEntity,
	seedShow,
	seedShowEpisode,
} from "~/fixtures/plugins/media/media";
import { countMediaMonitoringRelationships } from "~/fixtures/plugins/media/media-monitoring";
import {
	assertCondition,
	assertTaggedError,
	requireObjectRecord,
	requirePresent,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const treeEntities = (tree: Effect.Success<ReturnType<typeof seedShow>>) => [
	{ id: tree.show.id, schemaSlug: "show" },
	...tree.seasons.map((season) => ({ id: season.id, schemaSlug: "show-season" })),
	...tree.episodes.map((episode) => ({ id: episode.id, schemaSlug: "show-episode" })),
];

type EntityEvent = Effect.Success<ReturnType<typeof listEventsForEntity>>[number];

const eventsForTree = (client: Client, tree: Effect.Success<ReturnType<typeof seedShow>>) =>
	Effect.gen(function* () {
		const all: Array<EntityEvent & { readonly entityId: string }> = [];
		for (const entity of treeEntities(tree)) {
			for (const event of yield* listEventsForEntity(client, entity.id, undefined, 100)) {
				all.push({ entityId: entity.id, ...event });
			}
		}
		return all;
	});

const mediaLibraryRows = (client: Client, entityId: string, schemaSlug: string) =>
	Effect.map(queryInMediaLibraryRelationship(client, entityId, schemaSlug), (result) =>
		result.data.entity?.type === "rows" ? result.data.entity.items : [],
	);

const collectionMembership = table("relationship", "collectionMembership");

const collectionMembershipsRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly collectionId: string }) => ({
		map: ({ memberships }) => Result.succeed(memberships.items),
		queries: {
			memberships: selectedRows(collectionMembership, {
				limit: 100,
				orderBy: [ascending(column(collectionMembership, "id"))],
				where: and(
					eq(column(collectionMembership, "sourceEntityId"), literal(input.entityId)),
					eq(column(collectionMembership, "targetEntityId"), literal(input.collectionId)),
					eq(column(collectionMembership, "relationshipSchemaSlug"), literal("member-of")),
				),
				selection: {
					sourceEntityId: selectedField(column(collectionMembership, "sourceEntityId"), EntityId),
					targetEntityId: selectedField(column(collectionMembership, "targetEntityId"), EntityId),
					properties: selectedField(
						column(collectionMembership, "properties"),
						Schema.Record(Schema.String, Schema.Unknown),
					),
				},
			}),
		},
	}),
);

const collectionMemberships = (client: Client, entityId: string, collectionId: string) =>
	executeRyotQLRecipe(client, collectionMembershipsRecipe({ entityId, collectionId }));

const mediaRelationship = table("relationship", "mediaUserDataRelationship");

const mediaRelationshipsRecipe = defineRecipe(
	(input: {
		readonly sourceEntityId: string;
		readonly targetEntityId: string;
		readonly relationshipSchemaSlug: string;
	}) => ({
		map: ({ relationships }) => Result.succeed(relationships.items),
		queries: {
			relationships: selectedRows(mediaRelationship, {
				limit: 100,
				orderBy: [ascending(column(mediaRelationship, "id"))],
				selection: { id: selectedField(column(mediaRelationship, "id"), Schema.String) },
				where: and(
					eq(column(mediaRelationship, "sourceEntityId"), literal(input.sourceEntityId)),
					eq(column(mediaRelationship, "targetEntityId"), literal(input.targetEntityId)),
					eq(
						column(mediaRelationship, "relationshipSchemaSlug"),
						literal(input.relationshipSchemaSlug),
					),
				),
			}),
		},
	}),
);

const mediaRelationshipCount = (
	client: Client,
	input: {
		readonly sourceEntityId: string;
		readonly targetEntityId: string;
		readonly relationshipSchemaSlug: string;
	},
) =>
	Effect.map(
		executeRyotQLRecipe(client, mediaRelationshipsRecipe(input)),
		(relationships) => relationships.length,
	);

const collectionEventReferences = (client: Client, collectionId: string) =>
	Effect.map(listEventsForEntity(client, collectionId, undefined, 100), (events) =>
		events.flatMap((event) => {
			const entityId = event.properties["entityId"];
			return typeof entityId === "string" ? [entityId] : [];
		}),
	);

type EditorEntitySchema = SaveEditorSubmission["entitySchema"];
type EditorSubmission = ContractPayload<"entities", "saveEditor">["submission"];
type SaveEditorSubmission = Extract<EditorSubmission, { readonly action: "save" }>;

const saveCustomEntity = (
	client: Client,
	input: {
		readonly name: string;
		readonly entitySchema: EditorEntitySchema;
		readonly properties: Record<string, unknown>;
		readonly relationships?: SaveEditorSubmission["relationships"];
	},
) =>
	client.call((contract) =>
		contract.entities.saveEditor({
			payload: {
				submittedAt: nowIso(),
				idempotencyKey: crypto.randomUUID(),
				submission: {
					action: "save",
					name: input.name,
					target: { kind: "create" },
					properties: input.properties,
					entitySchema: input.entitySchema,
					relationships: input.relationships ?? [],
				},
			},
		}),
	);

const customShowTree = (client: Client) =>
	Effect.gen(function* () {
		const [showSchema, seasonSchema, episodeSchema] = yield* Effect.all([
			findMediaEntitySchema(client, "show"),
			findMediaEntitySchema(client, "show-season"),
			findMediaEntitySchema(client, "show-episode"),
		]);
		const show = yield* saveCustomEntity(client, {
			entitySchema: showSchema.schema.reference,
			name: `Edited custom show ${crypto.randomUUID()}`,
			properties: { productionStatus: "Ended", description: "Show metadata" },
		});
		assertCondition(show.output.kind === "saved", "Expected custom show to save");
		const season = yield* saveCustomEntity(client, {
			entitySchema: seasonSchema.schema.reference,
			name: `Edited custom season ${crypto.randomUUID()}`,
			properties: { seasonNumber: 1, description: "Season metadata" },
			relationships: [
				{
					relationshipSchemaSlug: "show-to-show-season",
					targets: [{ properties: {}, entityId: EntityId.make(show.output.entityId) }],
				},
			],
		});
		assertCondition(season.output.kind === "saved", "Expected custom season to save");
		const episode = yield* saveCustomEntity(client, {
			entitySchema: episodeSchema.schema.reference,
			name: `Edited custom episode ${crypto.randomUUID()}`,
			properties: { seasonNumber: 1, episodeNumber: 1, description: "Episode metadata" },
			relationships: [
				{
					relationshipSchemaSlug: "show-season-to-show-episode",
					targets: [{ properties: {}, entityId: EntityId.make(season.output.entityId) }],
				},
			],
		});
		assertCondition(episode.output.kind === "saved", "Expected custom episode to save");
		return {
			owner: showSchema.schema.reference.owner,
			entities: [
				{
					schemaSlug: "show",
					id: show.output.entityId,
					properties: { productionStatus: "Ended", description: "Show metadata" },
				},
				{
					schemaSlug: "show-season",
					id: season.output.entityId,
					properties: { seasonNumber: 1, description: "Season metadata" },
				},
				{
					schemaSlug: "show-episode",
					id: episode.output.entityId,
					properties: { seasonNumber: 1, episodeNumber: 1, description: "Episode metadata" },
				},
			],
		};
	});

describe("Media entity user data HTTP operations", () => {
	it.live(
		"clears a complete show tree, then accepts new data without replaying the old clear",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const other = yield* createAuthenticatedClient();
				const tree = yield* seedShow(client, {
					inLibrary: false,
					name: `Clear source ${crypto.randomUUID()}`,
					properties: { productionStatus: "Ended", description: "Show metadata survives" },
					seasons: [
						{ seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
						{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] },
					],
				});
				const entities = treeEntities(tree);
				const collection = yield* createCollection(client, {
					name: `Clear collection ${crypto.randomUUID()}`,
				});
				for (const entity of entities) {
					yield* client.call((contract) =>
						contract.collections.createMembership({
							payload: { collectionId: collection.id, entityId: EntityId.make(entity.id) },
						}),
					);
					yield* insertLibraryMembership(client, {
						mediaEntityId: entity.id,
						properties: { owned: true },
					});
					yield* insertMediaMonitoring(client, entity.id);
				}
				yield* waitForEventCount(client, collection.id, entities.length);

				const [{ schema: showSchema }, { schema: seasonSchema }, { schema: episodeSchema }] =
					yield* Effect.all([
						findMediaEntitySchema(client, "show"),
						findMediaEntitySchema(client, "show-season"),
						findMediaEntitySchema(client, "show-episode"),
					]);
				for (const [entity, schema] of [
					[tree.show, showSchema],
					[tree.seasons[0], seasonSchema],
					[tree.episodes[0], episodeSchema],
					[tree.episodes[1], episodeSchema],
				] as const) {
					assertCondition(entity !== undefined, "Expected all seeded show nodes");
					const eventSchemas = yield* listEventSchemas(client, schema.reference);
					yield* createEventFixture(client, {
						entityId: entity.id,
						occurredAt: "2026-03-01T10:00:00.000Z",
						properties: { rating: 76, text: `Review ${entity.name}` },
						eventSchemaSlug: requireEventSchemaBySlug(eventSchemas, "review").id,
					});
				}
				const episodeEventSchemas = yield* listEventSchemas(client, episodeSchema.reference);
				const detachedEpisodeProperties = {
					seasonNumber: 1,
					episodeNumber: 2,
					description: "Detached episode metadata survives",
				};
				const detachedEpisode = yield* createEntity(client, {
					entitySchema: episodeSchema.reference,
					properties: detachedEpisodeProperties,
					name: `Detached clear episode ${crypto.randomUUID()}`,
				});
				yield* createEventFixture(client, {
					entityId: detachedEpisode.id,
					sessionEntityId: tree.show.id,
					occurredAt: "2026-03-01T11:00:00.000Z",
					properties: { rating: 74, text: "Detached episode review" },
					eventSchemaSlug: requireEventSchemaBySlug(episodeEventSchemas, "review").id,
				});

				const peer = yield* findMediaEntitySchema(client, "movie");
				const trackedEpisode = requirePresent(tree.episodes[0], "Expected a regular episode");
				const peerEntity = yield* seedMediaEntity({
					userId: null,
					properties: {},
					providerId: null,
					target: client.target,
					entitySchemaSlug: peer.schema.id,
					externalId: `clear-relationship-${crypto.randomUUID()}`,
					name: `Clear relationship target ${crypto.randomUUID()}`,
				});
				const mediaRelationships = yield* listRelationshipSchemas(client, {
					owner: showSchema.reference.owner,
					slugs: ["media-suggestion", "media-trending"],
				});
				yield* createRelationship(client, {
					properties: {},
					sourceEntityId: EntityId.make(tree.show.id),
					targetEntityId: EntityId.make(peerEntity.id),
					relationshipSchema: requireRelationshipSchemaBySlug(
						mediaRelationships,
						"media-suggestion",
						showSchema.reference.owner,
					).reference,
				});
				yield* createRelationship(client, {
					properties: { rank: 1, fetchedAt: nowIso() },
					targetEntityId: EntityId.make(peerEntity.id),
					sourceEntityId: EntityId.make(trackedEpisode.id),
					relationshipSchema: requireRelationshipSchemaBySlug(
						mediaRelationships,
						"media-trending",
						showSchema.reference.owner,
					).reference,
				});

				const specialId = tree.episodeId(0, 1);
				const regularId = tree.episodeId(1, 1);
				for (const [episodeId, finishedOn] of [
					[specialId, "2026-03-02T10:00:00.000Z"],
					[regularId, "2026-03-03T10:00:00.000Z"],
				] as const) {
					yield* logMediaActivity(client, {
						submittedAt: nowIso(),
						submissionId: crypto.randomUUID(),
						entry: {
							kind: "episodes",
							parentEntityId: tree.show.id,
							episodeEntityIds: [episodeId],
							when: { finishedOn, kind: "date" },
						},
					});
				}
				const otherReviewSchemas = yield* listEventSchemas(other.client, showSchema.reference);
				yield* createEventFixture(other.client, {
					entityId: tree.show.id,
					occurredAt: "2026-03-04T10:00:00.000Z",
					properties: { rating: 99, text: "Another user's review" },
					eventSchemaSlug: requireEventSchemaBySlug(otherReviewSchemas, "review").id,
				});
				yield* settledHistoryCorrection(client, userId);
				const before = yield* eventsForTree(client, tree);
				const detachedEpisodeEvents = yield* listEventsForEntity(
					client,
					detachedEpisode.id,
					undefined,
					100,
				);
				expect(before.length).toBeGreaterThan(0);
				expect(
					detachedEpisodeEvents.some(({ eventSchemaSlug }) => eventSchemaSlug === "review"),
				).toBe(true);
				const clearRequest = { submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() };
				const cleared = yield* clearEntityUserData(client, tree.show.id, clearRequest);
				expect(cleared.entityId).toBe(tree.show.id);
				expect(cleared.deletedEventsCount).toBeGreaterThan(0);
				expect(cleared.deletedRelationshipsCount).toBeGreaterThan(0);
				for (const entity of entities) {
					expect(yield* listEventsForEntity(client, entity.id, undefined, 100)).toEqual([]);
					expect(yield* mediaLibraryRows(client, entity.id, entity.schemaSlug)).toEqual([]);
					expect(
						yield* countMediaMonitoringRelationships({
							client,
							entityId: entity.id,
							entitySchemaSlug: entity.schemaSlug,
						}),
					).toBe(0);
					expect(yield* collectionMemberships(client, entity.id, collection.id)).toEqual([]);
				}
				expect(yield* listEventsForEntity(client, detachedEpisode.id, undefined, 100)).toEqual([]);
				expect((yield* getEntity(client, detachedEpisode.id)).properties).toEqual(
					detachedEpisodeProperties,
				);
				expect(
					yield* mediaRelationshipCount(client, {
						sourceEntityId: tree.show.id,
						targetEntityId: peerEntity.id,
						relationshipSchemaSlug: "media-suggestion",
					}),
				).toBe(0);
				expect(
					yield* mediaRelationshipCount(client, {
						targetEntityId: peerEntity.id,
						sourceEntityId: trackedEpisode.id,
						relationshipSchemaSlug: "media-trending",
					}),
				).toBe(0);
				const treeIds = new Set<string>(entities.map(({ id }) => id));
				expect(
					(yield* collectionEventReferences(client, collection.id)).filter((id) => treeIds.has(id)),
				).toEqual([]);
				expect(
					(yield* listEventsForEntity(other.client, tree.show.id, undefined, 100, {
						eventSchemaSlug: "review",
					})).map(({ properties }) => properties["text"]),
				).toEqual(["Another user's review"]);
				const preservedShow = yield* getEntity(client, tree.show.id);
				expect(preservedShow.properties).toMatchObject({
					productionStatus: "Ended",
					description: "Show metadata survives",
				});
				for (const season of tree.seasons) {
					expect(
						yield* findRelationshipBySchema(client, {
							targetEntityId: season.id,
							sourceEntityId: tree.show.id,
							owner: showSchema.reference.owner,
							relationshipSchemaSlug: "show-to-show-season",
						}),
					).toMatchObject({ targetEntityId: season.id, sourceEntityId: tree.show.id });
				}
				for (const episode of tree.episodes) {
					const season = tree.seasons.find(
						({ seasonNumber }) => seasonNumber === episode.seasonNumber,
					);
					assertCondition(season !== undefined, "Expected the episode's season to remain linked");
					expect(
						yield* findRelationshipBySchema(client, {
							sourceEntityId: season.id,
							targetEntityId: episode.id,
							owner: showSchema.reference.owner,
							relationshipSchemaSlug: "show-season-to-show-episode",
						}),
					).toMatchObject({ sourceEntityId: season.id, targetEntityId: episode.id });
				}

				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						kind: "episodes",
						parentEntityId: tree.show.id,
						episodeEntityIds: [regularId],
						when: { kind: "date", finishedOn: "2026-03-05T10:00:00.000Z" },
					},
				});
				yield* settledHistoryCorrection(client, userId);
				const restored = yield* eventsForTree(client, tree);
				expect(
					restored.some(
						({ entityId, eventSchemaSlug }) =>
							entityId === regularId && eventSchemaSlug === "complete",
					),
				).toBe(true);
				const replayed = yield* clearEntityUserData(client, tree.show.id, clearRequest);
				expect(replayed).toEqual(cleared);
				expect((yield* eventsForTree(client, tree)).map(({ id }) => id).sort()).toEqual(
					restored.map(({ id }) => id).sort(),
				);
			}),
	);

	it.live("merges show history without deduping events and remaps collection evidence", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const inventory = [
				{ seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
				{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] },
			] as const;
			const source = yield* seedShow(client, {
				inLibrary: false,
				seasons: inventory,
				properties: { productionStatus: "Ended" },
				name: `Merge source ${crypto.randomUUID()}`,
			});
			const target = yield* seedShow(client, {
				inLibrary: false,
				properties: { productionStatus: "Ended" },
				name: `Merge target ${crypto.randomUUID()}`,
				seasons: [
					{ seasonNumber: 0, episodes: [{ episodeNumber: 1 }] },
					{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] },
				],
			});
			const collection = yield* createCollection(client, {
				name: `Merge collection ${crypto.randomUUID()}`,
				fields: [
					{ type: "text", required: false, label: "Source note" },
					{ type: "text", required: false, label: "Target note" },
				],
			});
			const targetCollectionMembership = yield* client.call((contract) =>
				contract.collections.createMembership({
					payload: {
						collectionId: collection.id,
						entityId: EntityId.make(target.show.id),
						properties: { "target-note": "keep destination" },
					},
				}),
			);
			yield* client.call((contract) =>
				contract.collections.createMembership({
					payload: {
						collectionId: collection.id,
						entityId: EntityId.make(source.show.id),
						properties: { "source-note": "transfer source" },
					},
				}),
			);
			for (const entity of treeEntities(source)) {
				yield* insertLibraryMembership(client, {
					mediaEntityId: entity.id,
					properties: { owned: true },
				});
				yield* insertMediaMonitoring(client, entity.id);
			}
			for (const entity of treeEntities(target)) {
				yield* insertLibraryMembership(client, { mediaEntityId: entity.id });
			}

			const regularSourceId = source.episodeId(1, 1);
			const specialSourceId = source.episodeId(0, 1);
			const regularTargetId = target.episodeId(1, 1);
			const specialTargetId = target.episodeId(0, 1);
			const finishedOn = "2026-02-01T12:00:00.000Z";
			for (const [episodeEntityId, date] of [
				[regularSourceId, "2026-02-01T12:00:00.000Z"],
				[specialSourceId, "2026-02-02T12:00:00.000Z"],
			] as const) {
				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						kind: "episodes",
						parentEntityId: source.show.id,
						episodeEntityIds: [episodeEntityId],
						when: { kind: "date", finishedOn: date },
					},
				});
			}
			const [{ schema: showSchema }, { schema: seasonSchema }, { schema: episodeSchema }] =
				yield* Effect.all([
					findMediaEntitySchema(client, "show"),
					findMediaEntitySchema(client, "show-season"),
					findMediaEntitySchema(client, "show-episode"),
				]);
			const episodeEvents = yield* listEventSchemas(client, episodeSchema.reference);
			const seasonEvents = yield* listEventSchemas(client, seasonSchema.reference);
			const showEvents = yield* listEventSchemas(client, showSchema.reference);
			const equalReviewSlug = requireEventSchemaBySlug(episodeEvents, "review").id;
			const detachedSource = yield* createEntity(client, {
				entitySchema: episodeSchema.reference,
				name: `Detached source episode ${crypto.randomUUID()}`,
				properties: { seasonNumber: 1, episodeNumber: 2, description: "Retained source episode" },
			});
			const detachedTarget = yield* createEntity(client, {
				entitySchema: episodeSchema.reference,
				name: `Detached destination episode ${crypto.randomUUID()}`,
				properties: {
					seasonNumber: 1,
					episodeNumber: 2,
					description: "Retained destination episode",
				},
			});
			yield* createEventFixture(client, {
				entityId: detachedSource.id,
				sessionEntityId: source.show.id,
				eventSchemaSlug: equalReviewSlug,
				occurredAt: "2026-02-05T12:00:00.000Z",
				properties: { rating: 82, text: "Detached source episode review" },
			});
			yield* createEventFixture(client, {
				entityId: detachedTarget.id,
				sessionEntityId: target.show.id,
				eventSchemaSlug: equalReviewSlug,
				occurredAt: "2026-02-06T12:00:00.000Z",
				properties: { rating: 79, text: "Detached destination episode review" },
			});
			for (let index = 0; index < 2; index += 1) {
				yield* createEventFixture(client, {
					occurredAt: finishedOn,
					entityId: regularSourceId,
					sessionEntityId: source.show.id,
					eventSchemaSlug: equalReviewSlug,
					properties: { rating: 84, text: "Same-date review" },
				});
			}
			yield* createEventFixture(client, {
				occurredAt: finishedOn,
				entityId: regularTargetId,
				sessionEntityId: target.show.id,
				eventSchemaSlug: equalReviewSlug,
				properties: { rating: 84, text: "Same-date review" },
			});
			yield* createEventFixture(client, {
				occurredAt: "2026-02-03T12:00:00.000Z",
				properties: { rating: 80, text: "Season review" },
				eventSchemaSlug: requireEventSchemaBySlug(seasonEvents, "review").id,
				entityId: requirePresent(source.seasons[0], "Expected source season").id,
			});
			yield* createEventFixture(client, {
				entityId: source.show.id,
				occurredAt: "2026-02-04T12:00:00.000Z",
				properties: { rating: 81, text: "Show review" },
				eventSchemaSlug: requireEventSchemaBySlug(showEvents, "review").id,
			});
			yield* settledHistoryCorrection(client, userId);

			const sourceBefore = yield* eventsForTree(client, source);
			const detachedSourceBefore = yield* listEventsForEntity(
				client,
				detachedSource.id,
				undefined,
				100,
			);
			const detachedTargetBefore = yield* listEventsForEntity(
				client,
				detachedTarget.id,
				undefined,
				100,
			);
			const detachedSourceReview = requirePresent(
				detachedSourceBefore.find(({ eventSchemaSlug }) => eventSchemaSlug === "review"),
				"Expected the detached source review",
			);
			expect(detachedTargetBefore.some(({ eventSchemaSlug }) => eventSchemaSlug === "review")).toBe(
				true,
			);
			const sourceCollectionEvents = yield* listEventsForEntity(
				client,
				collection.id,
				undefined,
				100,
			);
			const request = {
				mergeFrom: EntityId.make(source.show.id),
				mergeInto: EntityId.make(target.show.id),
			};
			const submission = { submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() };
			const merged = yield* mergeEntityUserData(client, request, submission);
			expect(merged.mergeFrom).toBe(source.show.id);
			expect(merged.mergeInto).toBe(target.show.id);
			yield* settledHistoryCorrection(client, userId);
			const targetAfter = yield* eventsForTree(client, target);
			const targetEntityBySource = new Map<string, string>([
				[source.show.id, target.show.id],
				...source.seasons.map((season) => {
					const matchingSeason = requirePresent(
						target.seasons.find(({ seasonNumber }) => seasonNumber === season.seasonNumber),
						"Expected a matching target season",
					);
					return [season.id, matchingSeason.id] as const;
				}),
				...source.episodes.map(
					(episode) =>
						[episode.id, target.episodeId(episode.seasonNumber, episode.episodeNumber)] as const,
				),
			]);
			for (const event of sourceBefore) {
				const targetId = targetEntityBySource.get(event.entityId);
				assertCondition(targetId !== undefined, "Expected a matching target entity");
				const moved = targetAfter.find(({ id }) => id === event.id);
				expect(moved).toMatchObject({
					entityId: targetId,
					occurredAt: event.occurredAt,
					properties: event.properties,
					sessionEntityId:
						event.sessionEntityId === source.show.id ? target.show.id : event.sessionEntityId,
				});
			}
			const movedDetachedEvent = targetAfter.find(({ id }) => id === detachedSourceReview.id);
			expect(movedDetachedEvent).toMatchObject({
				sessionEntityId: target.show.id,
				entityId: target.episodeId(1, 2),
				properties: detachedSourceReview.properties,
			});
			expect(yield* listEventsForEntity(client, detachedSource.id, undefined, 100)).toEqual([]);
			expect(yield* listEventsForEntity(client, detachedTarget.id, undefined, 100)).toEqual(
				detachedTargetBefore,
			);
			const sameDateReviews = targetAfter.filter(
				({ entityId, occurredAt, properties, eventSchemaSlug }) =>
					entityId === regularTargetId &&
					eventSchemaSlug === "review" &&
					occurredAt === finishedOn &&
					properties["text"] === "Same-date review",
			);
			expect(sameDateReviews).toHaveLength(3);
			expect(new Set(sameDateReviews.map(({ id }) => id)).size).toBe(3);
			expect(
				targetAfter.some(
					({ entityId, eventSchemaSlug }) =>
						entityId === specialTargetId && eventSchemaSlug === "complete",
				),
			).toBe(true);
			expect(
				targetAfter.some(
					({ entityId, eventSchemaSlug }) =>
						entityId === regularTargetId && eventSchemaSlug === "complete",
				),
			).toBe(true);
			expect((yield* eventsForTree(client, source)).map(({ id }) => id)).toEqual([]);
			for (const entity of treeEntities(source)) {
				expect(yield* mediaLibraryRows(client, entity.id, entity.schemaSlug)).toEqual([]);
				expect(
					yield* countMediaMonitoringRelationships({
						client,
						entityId: entity.id,
						entitySchemaSlug: entity.schemaSlug,
					}),
				).toBe(0);
			}
			expect(yield* mediaLibraryRows(client, target.show.id, "show")).toHaveLength(1);
			const sourceMembership = yield* collectionMemberships(client, source.show.id, collection.id);
			const targetMembership = yield* collectionMemberships(client, target.show.id, collection.id);
			expect(sourceMembership).toEqual([]);
			expect(targetMembership).toHaveLength(1);
			const destinationFields = requireObjectRecord(
				targetCollectionMembership.memberOf.properties,
				"Expected destination membership properties",
			);
			expect(targetMembership[0]?.properties).toEqual({
				rank: destinationFields["rank"],
				"source-note": "transfer source",
				"target-note": "keep destination",
			});
			const sourceIds = new Set<string>(treeEntities(source).map(({ id }) => id));
			const targetIds = new Set<string>(treeEntities(target).map(({ id }) => id));
			const collectionAfter = yield* listEventsForEntity(client, collection.id, undefined, 100);
			expect(
				collectionAfter.some(({ id }) => sourceCollectionEvents.some((old) => old.id === id)),
			).toBe(true);
			expect(
				collectionAfter.some(({ properties }) => {
					const id = properties["entityId"];
					return typeof id === "string" && sourceIds.has(id);
				}),
			).toBe(false);
			expect(
				collectionAfter.filter(({ properties }) => {
					const id = properties["entityId"];
					return typeof id === "string" && targetIds.has(id);
				}).length,
			).toBeGreaterThanOrEqual(2);
			const replay = yield* mergeEntityUserData(client, request, submission);
			expect(replay).toEqual(merged);
		}),
	);

	it.live(
		"rejects missing and ambiguous child mappings before writes, then merges after a match exists",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const source = yield* seedShow(client, {
					inLibrary: false,
					properties: { productionStatus: "Ended" },
					name: `Mapping source ${crypto.randomUUID()}`,
					seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }],
				});
				const target = yield* seedShow(client, {
					inLibrary: false,
					properties: { productionStatus: "Ended" },
					name: `Mapping target ${crypto.randomUUID()}`,
					seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }],
				});
				yield* insertLibraryMembership(client, {
					properties: { owned: true },
					mediaEntityId: source.show.id,
				});
				yield* insertLibraryMembership(client, {
					properties: { owned: true },
					mediaEntityId: source.episodeId(1, 2),
				});
				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						kind: "episodes",
						parentEntityId: source.show.id,
						episodeEntityIds: [source.episodeId(1, 2)],
						when: { kind: "date", finishedOn: "2026-01-10T12:00:00.000Z" },
					},
				});
				yield* settledHistoryCorrection(client, userId);
				const originalEvents = yield* listEventsForEntity(
					client,
					source.episodeId(1, 2),
					undefined,
					100,
				);
				const originalSourceMembership = yield* mediaLibraryRows(
					client,
					source.episodeId(1, 2),
					"show-episode",
				);
				const originalTargetEvents = yield* eventsForTree(client, target);
				const operationSubmissionId = crypto.randomUUID();
				expect(
					yield* client.call((contract) =>
						contract.plugins.invoke({
							params: {
								...pluginPackageSegments(mediaPlugin.metadata.packageId),
								operationSlug: "media-user-data",
							},
							payload: {
								idempotencyKey: operationSubmissionId,
								payload: {
									action: "merge",
									submittedAt: nowIso(),
									entitySchemaSlug: "show",
									mergeFrom: source.show.id,
									mergeInto: target.show.id,
									submissionId: operationSubmissionId,
								},
							},
						}),
					),
				).toMatchObject({ result: { status: "rejected" } });
				const failed = yield* Effect.flip(
					mergeEntityUserData(client, {
						mergeFrom: EntityId.make(source.show.id),
						mergeInto: EntityId.make(target.show.id),
					}),
				);
				assertTaggedError(failed, "EntityUserDataBadRequest");
				expect(failed.reason).toMatchObject({ code: "child-mapping-conflict" });
				expect(yield* listEventsForEntity(client, source.episodeId(1, 2), undefined, 100)).toEqual(
					originalEvents,
				);
				expect(yield* mediaLibraryRows(client, source.episodeId(1, 2), "show-episode")).toEqual(
					originalSourceMembership,
				);
				expect(yield* eventsForTree(client, target)).toEqual(originalTargetEvents);
				expect(yield* mediaLibraryRows(client, source.show.id, "show")).toHaveLength(1);

				const targetSeason = target.seasons.find(({ seasonNumber }) => seasonNumber === 1);
				assertCondition(targetSeason !== undefined, "Expected target season one");
				const matching = yield* seedShowEpisode(client, {
					seasonNumber: 1,
					seasonId: targetSeason.id,
					episode: { episodeNumber: 2 },
					suffix: `mapping-retry-${crypto.randomUUID()}`,
				});
				const retryRequest = {
					mergeFrom: EntityId.make(source.show.id),
					mergeInto: EntityId.make(target.show.id),
				};
				const retrySubmission = { submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() };
				const merged = yield* mergeEntityUserData(client, retryRequest, retrySubmission);
				expect(merged.mergeFrom).toBe(source.show.id);
				const matchingEventIds = new Set(
					(yield* listEventsForEntity(client, matching.id, undefined, 100)).map(({ id }) => id),
				);
				expect(originalEvents.every(({ id }) => matchingEventIds.has(id))).toBe(true);
				expect(yield* listEventsForEntity(client, source.episodeId(1, 2), undefined, 100)).toEqual(
					[],
				);

				const duplicate = yield* seedShowEpisode(client, {
					seasonNumber: 1,
					seasonId: targetSeason.id,
					episode: { episodeNumber: 2 },
					suffix: `mapping-duplicate-${crypto.randomUUID()}`,
				});
				const ambiguousSource = yield* seedShow(client, {
					inLibrary: false,
					properties: { productionStatus: "Ended" },
					name: `Ambiguous source ${crypto.randomUUID()}`,
					seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 2 }] }],
				});
				yield* insertLibraryMembership(client, {
					properties: { owned: true },
					mediaEntityId: ambiguousSource.episodeId(1, 2),
				});
				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						kind: "episodes",
						parentEntityId: ambiguousSource.show.id,
						episodeEntityIds: [ambiguousSource.episodeId(1, 2)],
						when: { kind: "date", finishedOn: "2026-01-11T12:00:00.000Z" },
					},
				});
				yield* settledHistoryCorrection(client, userId);
				const ambiguousBefore = yield* listEventsForEntity(
					client,
					ambiguousSource.episodeId(1, 2),
					undefined,
					100,
				);
				const targetBefore = yield* eventsForTree(client, target);
				const ambiguousFailure = yield* Effect.flip(
					mergeEntityUserData(client, {
						mergeInto: EntityId.make(target.show.id),
						mergeFrom: EntityId.make(ambiguousSource.show.id),
					}),
				);
				assertTaggedError(ambiguousFailure, "EntityUserDataBadRequest");
				expect(ambiguousFailure.reason).toMatchObject({ code: "child-mapping-conflict" });
				expect(
					yield* listEventsForEntity(client, ambiguousSource.episodeId(1, 2), undefined, 100),
				).toEqual(ambiguousBefore);
				expect(
					yield* mediaLibraryRows(client, ambiguousSource.episodeId(1, 2), "show-episode"),
				).toHaveLength(1);
				expect(yield* eventsForTree(client, target)).toEqual(targetBefore);
				expect(yield* listEventsForEntity(client, duplicate.id, undefined, 100)).toEqual([]);
			}),
	);

	it.live(
		"removes user state from editor-authored custom episodes without changing metadata or links",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const tree = yield* customShowTree(client);
				for (const entity of tree.entities) {
					yield* insertLibraryMembership(client, {
						mediaEntityId: entity.id,
						properties: { owned: true },
					});
				}
				for (const entity of tree.entities) {
					const schema = yield* findMediaEntitySchema(client, entity.schemaSlug);
					const eventSchemas = yield* listEventSchemas(client, schema.schema.reference);
					yield* createEventFixture(client, {
						entityId: entity.id,
						occurredAt: "2026-01-12T12:00:00.000Z",
						properties: { rating: 72, text: "Custom review" },
						eventSchemaSlug: requireEventSchemaBySlug(eventSchemas, "review").id,
					});
				}
				const clearRequest = { submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() };
				const [showEntity, seasonEntity, episodeEntity] = tree.entities;
				assertCondition(
					showEntity !== undefined && seasonEntity !== undefined && episodeEntity !== undefined,
					"Expected a complete custom show tree",
				);
				yield* clearEntityUserData(client, showEntity.id, clearRequest);
				for (const entity of tree.entities) {
					expect(yield* listEventsForEntity(client, entity.id, undefined, 100)).toEqual([]);
					expect(yield* mediaLibraryRows(client, entity.id, entity.schemaSlug)).toEqual([]);
					const actual = yield* getEntity(client, entity.id);
					expect(actual.properties).toEqual(entity.properties);
				}
				expect(
					yield* findRelationshipBySchema(client, {
						owner: tree.owner,
						sourceEntityId: showEntity.id,
						targetEntityId: seasonEntity.id,
						relationshipSchemaSlug: "show-to-show-season",
					}),
				).toMatchObject({
					properties: {},
					sourceEntityId: showEntity.id,
					targetEntityId: seasonEntity.id,
				});
				expect(
					yield* findRelationshipBySchema(client, {
						owner: tree.owner,
						sourceEntityId: seasonEntity.id,
						targetEntityId: episodeEntity.id,
						relationshipSchemaSlug: "show-season-to-show-episode",
					}),
				).toMatchObject({
					properties: {},
					sourceEntityId: seasonEntity.id,
					targetEntityId: episodeEntity.id,
				});
			}),
	);
});
