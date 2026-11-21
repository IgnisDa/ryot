import { expect, it } from "bun:test";

import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { CHANGE_SET_LIMITS } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";

import definition, { manifest } from "./exercise-merge.sandbox";

type Row = Readonly<Record<string, unknown>>;

const mergeFrom = EntityId.make("custom-1");
const mergeInto = EntityId.make("global-1");

const subject = (id: string, kind = "reps_weight") => ({ id, kind });

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

const run = (
	tables: Readonly<Record<string, ReadonlyArray<Row>>>,
	input: { mergeFrom: EntityId; mergeInto: EntityId } = { mergeFrom, mergeInto },
) =>
	definition.run(
		input,
		defineSandboxTestHost(manifest, {
			executeRyotql: (document) => Effect.succeed(rowsFor(bindTestRequest(document), tables)),
		}),
	);

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

const subjects = [subject(mergeFrom), subject(mergeInto)];

it("rejects each invalid merge", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const cases = [
				[{ mergeFrom, mergeInto: mergeFrom }, {}, "same"],
				[{ mergeFrom, mergeInto }, { exercises: [subject(mergeInto)] }, "missing"],
				[{ mergeFrom, mergeInto }, { exercises: [subject(mergeFrom)] }, "missing"],
				[
					{ mergeFrom, mergeInto },
					{ exercises: [subject(mergeFrom), subject(mergeInto, "duration")] },
					"kind-mismatch",
				],
			] as const;
			for (const [input, tables, code] of cases) {
				expect(yield* Effect.flip(run(tables, input))).toMatchObject({
					_tag: "OperationRejectedError",
					reason: { key: `rejection.exercise-merge.${code}` },
				});
			}
		}),
	));

it("detaches the source, merges its data, and swaps template references in one change set", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const matching = template("template-1", ["other", mergeFrom, mergeFrom]);
			const result = yield* run({
				exercises: subjects,
				templates: [matching, template("template-2", ["other"])],
				links: [
					{ slug: "in-fitness-library", targetEntityId: "library-1" },
					{ targetEntityId: "chest", slug: "exercise-targets" },
					{ targetEntityId: "barbell", slug: "exercise-uses-equipment" },
				],
			});

			expect(result).toEqual<unknown>({
				output: { mergeInto },
				changes: {
					relationships: {
						deletes: [
							["in-fitness-library", "library-1"],
							["exercise-targets", "chest"],
							["exercise-uses-equipment", "barbell"],
						].map(([relationshipSchemaSlug, entityId]) => ({
							relationshipSchemaSlug,
							target: { entityId, kind: "existing" },
							source: { kind: "existing", entityId: mergeFrom },
						})),
					},
					entities: {
						merges: [{ mergeFrom, mergeInto, entitySchemaSlug: "exercise" }],
						updates: [
							{
								name: matching.name,
								entitySchemaSlug: "workout-template",
								properties: {
									comment: "Push",
									exercises: ["other", mergeInto, mergeInto].map(occurrence),
								},
								target: {
									kind: "update",
									entityId: matching.id,
									expected: {
										name: matching.name,
										updatedAt: matching.updatedAt,
										properties: matching.properties,
									},
								},
							},
						],
					},
				},
			});
		}),
	));

it("merges with no detaches or template updates after the source was already detached", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			expect(yield* run({ links: [], templates: [], exercises: subjects })).toEqual<unknown>({
				output: { mergeInto },
				changes: {
					relationships: { deletes: [] },
					entities: {
						updates: [],
						merges: [{ mergeFrom, mergeInto, entitySchemaSlug: "exercise" }],
					},
				},
			});
		}),
	));

it("rejects a merge whose templates exceed one change set's entity updates", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const templates = Array.from({ length: CHANGE_SET_LIMITS.entityUpdates + 1 }, (_, index) =>
				template(`template-${index}`, [mergeFrom]),
			);
			expect(yield* Effect.flip(run({ templates, links: [], exercises: subjects }))).toMatchObject({
				_tag: "OperationRejectedError",
				reason: { key: "rejection.exercise-merge.too-many-templates" },
			});
			const allowed = yield* run({ links: [], exercises: subjects, templates: templates.slice(1) });
			expect(allowed.changes.entities.updates).toHaveLength(CHANGE_SET_LIMITS.entityUpdates);
		}),
	));
