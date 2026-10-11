import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { expect, it } from "vitest";

import definition, { manifest } from "./exercise-merge.sandbox";

type Row = Readonly<Record<string, unknown>>;

const mergeFrom = EntityId.make("custom-1");
const mergeInto = EntityId.make("global-1");

const subject = (id: string, userId: string | null, kind = "reps_weight") => ({ id, kind, userId });

const rowsFor = (
	document: RyotQLDocument,
	tables: Readonly<Record<string, ReadonlyArray<Row>>>,
) => ({
	data: Object.fromEntries(
		Object.keys(document.queries).map((key) => [
			key,
			{
				type: "rows",
				items: tables[key] ?? [],
				pageInfo: { limit: 100, hasMore: false, nextCursor: null },
			},
		]),
	),
});

const recordingHost = (tables: Readonly<Record<string, ReadonlyArray<Row>>>) => {
	const writes: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: (document) => Effect.succeed(rowsFor(document, tables)),
		updateUserEntity: (item) =>
			Effect.sync(() => {
				writes.push({ update: item });
				return { entityId: item.entityId };
			}),
		mergeUserEntityData: (item) =>
			Effect.sync(() => {
				writes.push({ merge: item });
				return { movedEventsCount: 2, movedRelationshipsCount: 0 };
			}),
		changeUserRelationships: (batches) =>
			Effect.sync(() => {
				writes.push({ detach: batches });
				return batches.map(() => ({ created: 0, deleted: 1 }));
			}),
	});
	return { host, writes };
};

const run = (
	tables: Readonly<Record<string, ReadonlyArray<Row>>>,
	input: { mergeFrom: EntityId; mergeInto: EntityId } = { mergeFrom, mergeInto },
) => {
	const { host, writes } = recordingHost(tables);
	return definition.run(input, host).pipe(Effect.map((output) => ({ output, writes })));
};

const occurrence = (exerciseId: string, order: number) => ({
	sets: [],
	notes: [],
	exerciseId,
	exerciseOrder: order,
});

const template = (id: string, exerciseIds: ReadonlyArray<string>) => ({
	id,
	name: `Template ${id}`,
	updatedAt: "2026-10-01T00:00:00.000Z",
	properties: { comment: "Push", exercises: exerciseIds.map(occurrence) },
});

it("returns a typed failure for each invalid merge without writing", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const cases = [
				[{ mergeFrom, mergeInto: mergeFrom }, {}, "same"],
				[{ mergeFrom, mergeInto }, { exercises: [subject(mergeInto, null)] }, "missing"],
				[{ mergeFrom, mergeInto }, { exercises: [subject(mergeFrom, "user-1")] }, "missing"],
				[
					{ mergeFrom, mergeInto },
					{ exercises: [subject(mergeFrom, null), subject(mergeInto, null)] },
					"not-custom",
				],
				[
					{ mergeFrom, mergeInto },
					{ exercises: [subject(mergeFrom, "user-1"), subject(mergeInto, null, "duration")] },
					"kind-mismatch",
				],
			] as const;
			for (const [input, tables, kind] of cases) {
				const { output, writes } = yield* run(tables, input);
				expect(output).toEqual({ kind });
				expect(writes).toEqual([]);
			}
		}),
	));

it("detaches the source, merges its data, and swaps template references", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const matching = template("template-1", ["other", mergeFrom, mergeFrom]);
			const { output, writes } = yield* run({
				templates: [matching, template("template-2", ["other"])],
				exercises: [subject(mergeFrom, "user-1"), subject(mergeInto, null)],
				links: [
					{ slug: "in-fitness-library", targetEntityId: "library-1" },
					{ targetEntityId: "chest", slug: "exercise-targets" },
					{ targetEntityId: "barbell", slug: "exercise-uses-equipment" },
				],
			});

			expect(output).toEqual({ mergeInto, kind: "merged" });
			expect(writes).toEqual([
				{
					detach: [
						{
							creates: [],
							deletes: [
								{
									sourceEntityId: mergeFrom,
									targetEntityId: "library-1",
									relationshipSchemaSlug: "in-fitness-library",
								},
								{
									targetEntityId: "chest",
									sourceEntityId: mergeFrom,
									relationshipSchemaSlug: "exercise-targets",
								},
								{
									sourceEntityId: mergeFrom,
									targetEntityId: "barbell",
									relationshipSchemaSlug: "exercise-uses-equipment",
								},
							],
						},
					],
				},
				{ merge: { mergeFrom, mergeInto, entitySchemaSlug: "exercise" } },
				{
					update: {
						name: matching.name,
						entityId: matching.id,
						properties: {
							comment: "Push",
							exercises: ["other", mergeInto, mergeInto].map(occurrence),
						},
						expected: {
							name: matching.name,
							updatedAt: matching.updatedAt,
							properties: matching.properties,
						},
					},
				},
			]);
		}),
	));

it("completes when re-run after the source was already detached", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { output, writes } = yield* run({
				links: [],
				templates: [],
				exercises: [subject(mergeFrom, "user-1"), subject(mergeInto, null)],
			});

			expect(output).toEqual({ mergeInto, kind: "merged" });
			expect(writes).toEqual([{ merge: { mergeFrom, mergeInto, entitySchemaSlug: "exercise" } }]);
		}),
	));
