import { expect } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { EntityId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { ascending, column, field, rows, table } from "@ryot-app/ryotql";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { type PublicationSubjectQuery, RyotQLService } from "./service";

const RESULT_BYTES = 2 * 1024 * 1024;
const occurredAt = new Date("2026-01-15");

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: "owner", name: "Owner", email: "owner@example.test" },
				{ id: "other", name: "Other", email: "other@example.test" },
			]);
			yield* db.insert(tables.entity).values([
				{ id: "a", name: "Alpha", userId: "owner", entitySchemaSlug: "root" },
				{ id: "b", name: "Beta", userId: "owner", entitySchemaSlug: "root" },
				{ id: "c", name: "Gamma", userId: "owner", entitySchemaSlug: "root" },
				{ id: "shelf", name: "Shelf", userId: "owner", entitySchemaSlug: "collection" },
				{ id: "foreign", name: "Foreign", userId: "other", entitySchemaSlug: "root" },
			]);
			yield* db.insert(tables.relationship).values([
				{
					userId: "owner",
					sourceEntityId: "a",
					targetEntityId: "shelf",
					properties: { rank: 2 },
					relationshipSchemaSlug: "member-of",
				},
				{
					userId: "owner",
					sourceEntityId: "b",
					targetEntityId: "shelf",
					properties: { rank: 1 },
					relationshipSchemaSlug: "member-of",
				},
				{
					userId: "owner",
					sourceEntityId: "a",
					targetEntityId: "b",
					properties: { rank: 1 },
					relationshipSchemaSlug: "member-of",
				},
				{
					userId: "owner",
					sourceEntityId: "a",
					targetEntityId: "b",
					relationshipSchemaSlug: "private-note",
				},
				{
					userId: null,
					sourceEntityId: "a",
					targetEntityId: "b",
					relationshipSchemaSlug: "sequel",
				},
				{
					userId: null,
					sourceEntityId: "a",
					targetEntityId: "c",
					relationshipSchemaSlug: "sequel",
				},
			]);
			yield* db
				.insert(tables.event)
				.values([
					{
						occurredAt,
						id: "watched",
						entityId: "a",
						userId: "owner",
						eventSchemaSlug: "occurrence",
					},
				]);
		}),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_publication_scope")),
	Layer.provide(makeAppConfigLayer()),
);

const shelf: PublicationSubjectQuery = {
	language: null,
	subjectLimit: 10,
	ownerUserId: "owner",
	source: { kind: "collection", collectionId: EntityId.make("shelf") },
};

const subject = table("entity", "subject");

const read = (document: RyotQLDocument, source = shelf) =>
	Effect.gen(function* () {
		const service = yield* RyotQLService;
		const result = (yield* service.executeForPublication(
			source,
			{ source: { document, kind: "inline" } },
			RESULT_BYTES,
		)).data["rows"];
		return result?.type === "rows" ? result.items : null;
	});

layer(databaseLayer)((test) => {
	test.effect("ranks the subjects in the order of the owner's scope query", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			expect(yield* service.resolvePublicationSubjects(shelf)).toEqual([
				{ rank: 1, entityId: "b" },
				{ rank: 2, entityId: "a" },
			]);
		}),
	);

	test.effect("shows only the subjects, in published order", () =>
		Effect.gen(function* () {
			const items = yield* read({
				queries: {
					rows: rows(subject, {
						orderBy: [ascending(column(subject, "publicationRank"))],
						fields: [
							field("id", column(subject, "id")),
							field("rank", column(subject, "publicationRank")),
						],
					}),
				},
			});
			expect(items).toEqual([
				{ id: "b", rank: 1 },
				{ id: "a", rank: 2 },
			]);
		}),
	);

	test.effect("shows global links and kernel memberships only between subjects", () =>
		Effect.gen(function* () {
			const link = table("relationship", "link");
			const items = yield* read({
				queries: {
					rows: rows(link, {
						orderBy: [ascending(column(link, "relationshipSchemaSlug"))],
						fields: [
							field("slug", column(link, "relationshipSchemaSlug")),
							field("target", column(link, "targetEntityId")),
						],
					}),
				},
			});
			expect(items).toEqual([
				{ target: "b", slug: "member-of" },
				{ target: "b", slug: "sequel" },
			]);
		}),
	);

	test.effect("hides events", () =>
		Effect.gen(function* () {
			const occurrence = table("event", "occurrence");
			const items = yield* read({
				queries: { rows: rows(occurrence, { fields: [field("id", column(occurrence, "id"))] }) },
			});
			expect(items).toEqual([]);
		}),
	);

	test.effect("rejects fields that identify the owner", () =>
		Effect.gen(function* () {
			const error = yield* read({
				queries: { rows: rows(subject, { fields: [field("user", column(subject, "userId"))] }) },
			}).pipe(Effect.flip);
			expect(error._tag).toBe("RyotQLBadRequest");
		}),
	);

	test.effect("rejects owner-only tables", () =>
		Effect.gen(function* () {
			const published = table("publication", "published");
			const error = yield* read({
				queries: { rows: rows(published, { fields: [field("id", column(published, "id"))] }) },
			}).pipe(Effect.flip);
			expect(error._tag).toBe("RyotQLBadRequest");
		}),
	);

	test.effect("refuses a scope that selects more subjects than the limit", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const error = yield* service
				.resolvePublicationSubjects({ ...shelf, subjectLimit: 1 })
				.pipe(Effect.flip);
			expect(error).toMatchObject({
				_tag: "RyotQLBadRequest",
				reason: { limit: 1, code: "subject-limit-exceeded" },
			});
		}),
	);

	test.effect("refuses a scope whose subject is not an entity", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const occurrence = table("event", "occurrence");
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.savedView)
					.values({
						icon: "box",
						userId: "owner",
						name: "Invalid",
						id: "invalid-subject",
						slug: "invalid-subject",
						renderer: { kind: "kernel", name: "entity-browser" },
						dataSources: {
							queries: {
								items: rows(occurrence, { fields: [field("id", column(occurrence, "id"))] }),
							},
						},
						settings: {
							pageSize: 10,
							addAction: null,
							layouts: ["grid"],
							tableColumns: null,
							sourceName: "items",
							defaultLayout: "grid",
							summary: { image: null, subtitle: null },
							subject: {
								entityAlias: occurrence.alias,
								schemas: [{ slug: "root", owner: { kind: "kernel" } }],
							},
						},
					}),
			);
			const error = yield* service
				.resolvePublicationSubjects({
					...shelf,
					source: {
						kind: "saved-view",
						reference: { kind: "custom", savedViewId: SavedViewId.make("invalid-subject") },
					},
				})
				.pipe(Effect.flip);
			expect(error).toMatchObject({ reason: { code: "invalid-query" } });
		}),
	);

	test.effect("does not select another user's entities", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const everything = table("entity", "everything");
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db.insert(tables.savedView).values({
					icon: "box",
					name: "Owned",
					id: "all-owned",
					userId: "owner",
					slug: "all-owned",
					renderer: { kind: "kernel", name: "entity-browser" },
					dataSources: {
						queries: {
							items: rows(everything, {
								fields: [field("id", column(everything, "id"))],
								orderBy: [ascending(column(everything, "name"))],
							}),
						},
					},
					settings: {
						pageSize: 10,
						addAction: null,
						layouts: ["grid"],
						tableColumns: null,
						sourceName: "items",
						defaultLayout: "grid",
						summary: { image: null, subtitle: null },
						subject: {
							entityAlias: everything.alias,
							schemas: [
								{ slug: "root", owner: { kind: "kernel" } },
								{ slug: "collection", owner: { kind: "kernel" } },
							],
						},
					},
				}),
			);
			const subjects = yield* service.resolvePublicationSubjects({
				...shelf,
				source: {
					kind: "saved-view",
					reference: { kind: "custom", savedViewId: SavedViewId.make("all-owned") },
				},
			});
			expect(subjects.map(({ entityId }) => entityId)).toEqual(["a", "b", "c", "shelf"]);
		}),
	);
});
