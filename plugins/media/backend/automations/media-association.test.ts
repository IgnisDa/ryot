import { expect, it } from "bun:test";

import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	automationContext,
	entityRecord,
	hostSuccess,
	returnedChanges,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-association.sandbox";

type InputOverrides = {
	rootEntityId?: string;
	afterRoles?: string[];
	beforeRoles?: string[];
	afterRoleCodes?: string[];
	beforeRoleCodes?: string[];
	rootPreviouslyPopulated?: boolean;
	subjectKind?: "person" | "company";
	targetKind?: "movie" | "music-group";
	operation?: "create" | "update" | "delete";
};

const roleCodes = (codes: string[] | undefined): Record<string, JsonValue> =>
	codes === undefined ? {} : { roleCodes: codes };

const input = (overrides: InputOverrides = {}) => {
	const operation = overrides.operation ?? "create";
	const targetKind = overrides.targetKind ?? "movie";
	const subjectKind = overrides.subjectKind ?? "person";
	const snapshot = (properties: Record<string, JsonValue>) => ({
		properties,
		id: "relationship-1",
		sourceEntityId: "subject-1",
		targetEntityId: "associated-1",
		createdAt: "2026-07-20T10:00:00.000Z",
		updatedAt: "2026-07-20T10:00:00.000Z",
		relationshipSchemaPluginId: "media-owner",
		relationshipSchemaSlug: `${subjectKind}-to-${targetKind}`,
	});
	let relationshipSource;
	if (operation === "create") {
		relationshipSource = {
			after: snapshot({
				roles: overrides.afterRoles ?? ["Director"],
				...roleCodes(overrides.afterRoleCodes),
			}),
		};
	} else if (operation === "update") {
		relationshipSource = {
			before: snapshot({
				roles: overrides.beforeRoles ?? ["Actor"],
				...roleCodes(overrides.beforeRoleCodes),
			}),
			after: snapshot({
				roles: overrides.afterRoles ?? ["Actor", "Director"],
				...roleCodes(overrides.afterRoleCodes),
			}),
		};
	} else {
		relationshipSource = { before: snapshot({ roles: overrides.beforeRoles ?? ["Actor"] }) };
	}
	const population = {
		rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
		scopeEntity: {
			name: "Barbie",
			entitySchemaSlug: targetKind,
			entitySchemaPluginId: "media-owner",
			id: overrides.rootEntityId ?? "associated-1",
		},
	};
	return {
		entities: [
			entityRecord({ name: "Barbie", id: "associated-1", entitySchemaSlug: targetKind }),
			entityRecord({ id: "subject-1", name: "Greta Gerwig", entitySchemaSlug: subjectKind }),
		],
		context: automationContext({
			category: "change",
			operation: "batch",
			resource: "relationship",
			items: [
				{
					operation,
					population,
					category: "change",
					resource: "relationship",
					...(operation === "update" ? { changedProperties: ["roles"] } : {}),
					...relationshipSource,
				},
			],
		}),
	};
};

const credit = (sourceEntityId: string, role: string) => ({
	category: "change",
	operation: "create",
	resource: "relationship",
	after: {
		sourceEntityId,
		properties: { roles: [role] },
		targetEntityId: "associated-1",
		id: `relationship-${sourceEntityId}`,
		createdAt: "2026-07-20T10:00:00.000Z",
		updatedAt: "2026-07-20T10:00:00.000Z",
		relationshipSchemaPluginId: "media-owner",
		relationshipSchemaSlug: "person-to-movie",
	},
});

const run = (value: ReturnType<typeof input>) =>
	value.context.pipe(
		Effect.flatMap((context) =>
			definition.run(
				context,
				defineSandboxTestHost(manifest, {
					executeRyotql: () => hostSuccess(ryotqlRows("entities", value.entities)),
				}),
			),
		),
		Effect.map((result) => returnedChanges(result).signals ?? []),
	);

it.each([
	["person", "movie", "person.media.associated"],
	["company", "movie", "company.media.associated"],
	["person", "music-group", "person.media-group.associated"],
	["company", "music-group", "company.media-group.associated"],
] as const)("maps a %s credit to a %s signal", (subjectKind, targetKind, schemaSlug) =>
	Effect.runPromise(
		run(input({ targetKind, subjectKind })).pipe(
			Effect.map((signals) => {
				expect(signals).toEqual([
					{
						schemaSlug,
						discriminator: "subject-1:role:Director",
						subjectEntityId: EntityId.make("subject-1"),
						properties: { role: "Director", associatedName: "Barbie", subjectName: "Greta Gerwig" },
					},
				]);
				return undefined;
			}),
		),
	),
);

it("suppresses only the credited subject's own first population", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ rootEntityId: "subject-1", rootPreviouslyPopulated: false })),
				run(input({ rootEntityId: "associated-1", rootPreviouslyPopulated: false })),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([subjectRoot, mediaRoot]) => {
				expect(subjectRoot).toEqual([]);
				expect(mediaRoot).toHaveLength(1);
				return undefined;
			}),
		),
	));

it("emits each newly added role once and ignores unchanged, removed, and deleted roles", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ operation: "update", afterRoles: ["Actor", "Director", "Director"] })),
				run(
					input({ operation: "update", afterRoles: ["Actor"], beforeRoles: ["Actor", "Director"] }),
				),
				run(input({ operation: "delete" })),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([added, removed, deleted]) => {
				expect(added.map(({ discriminator }) => discriminator)).toEqual([
					"subject-1:role:Director",
				]);
				expect(removed).toEqual([]);
				expect(deleted).toEqual([]);
				return undefined;
			}),
		),
	));

it("emits newly added standard role codes apart from named roles", () =>
	Effect.runPromise(
		run(
			input({
				operation: "update",
				afterRoles: ["Actor"],
				beforeRoleCodes: ["creator"],
				afterRoleCodes: ["creator", "author", "unknown"],
			}),
		).pipe(
			Effect.map((signals) => {
				expect(signals).toEqual([
					{
						schemaSlug: "person.media.associated",
						subjectEntityId: EntityId.make("subject-1"),
						discriminator: "subject-1:role-code:author",
						properties: {
							roleCode: "author",
							associatedName: "Barbie",
							subjectName: "Greta Gerwig",
						},
					},
				]);
				return undefined;
			}),
		),
	));

it("uses stable per-role discriminators across replay", () => {
	const value = input({ afterRoles: ["Actor", "Director"] });
	return Effect.runPromise(
		Effect.all([run(value), run(value)], { concurrency: "unbounded" }).pipe(
			Effect.map(([first, replay]) => {
				expect(first).toEqual(replay);
				expect(first.map(({ discriminator }) => discriminator)).toEqual([
					"subject-1:role:Actor",
					"subject-1:role:Director",
				]);
				return undefined;
			}),
		),
	);
});

it("ignores relationships in the batch that are not media credits", () =>
	Effect.runPromise(
		run({
			...input(),
			entities: [
				entityRecord({ name: "Barbie", id: "associated-1", entitySchemaSlug: "workout" }),
				entityRecord({ id: "subject-1", name: "Greta Gerwig", entitySchemaSlug: "person" }),
			],
		}).pipe(Effect.map((signals) => expect(signals).toEqual([]))),
	));

it("reads every credited entity in the batch with one query", () => {
	let reads = 0;
	return Effect.runPromise(
		Effect.gen(function* () {
			const result = yield* definition.run(
				yield* automationContext({
					category: "change",
					operation: "batch",
					resource: "relationship",
					items: [credit("subject-1", "Director"), credit("subject-2", "Writer")],
				}),
				defineSandboxTestHost(manifest, {
					executeRyotql: () => {
						reads += 1;
						return hostSuccess(
							ryotqlRows("entities", [
								entityRecord({ name: "Barbie", id: "associated-1", entitySchemaSlug: "movie" }),
								entityRecord({ id: "subject-1", name: "Greta Gerwig", entitySchemaSlug: "person" }),
								entityRecord({
									id: "subject-2",
									name: "Noah Baumbach",
									entitySchemaSlug: "person",
								}),
							]),
						);
					},
				}),
			);
			expect(reads).toBe(1);
			expect(
				(returnedChanges(result).signals ?? []).map(({ discriminator }) => discriminator),
			).toEqual(["subject-1:role:Director", "subject-2:role:Writer"]);
		}),
	);
});

it("returns one signal per subject role when the batch credits it more than once", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const result = yield* definition.run(
				yield* automationContext({
					category: "change",
					operation: "batch",
					resource: "relationship",
					items: [
						credit("subject-1", "Director"),
						{
							...credit("subject-1", "Director"),
							after: {
								...credit("subject-1", "Director").after,
								id: "relationship-sequel",
								targetEntityId: "associated-2",
							},
						},
					],
				}),
				defineSandboxTestHost(manifest, {
					executeRyotql: () =>
						hostSuccess(
							ryotqlRows("entities", [
								entityRecord({ name: "Barbie", id: "associated-1", entitySchemaSlug: "movie" }),
								entityRecord({ name: "Barbie 2", id: "associated-2", entitySchemaSlug: "movie" }),
								entityRecord({ id: "subject-1", name: "Greta Gerwig", entitySchemaSlug: "person" }),
							]),
						),
				}),
			);
			expect(returnedChanges(result).signals).toEqual([
				{
					schemaSlug: "person.media.associated",
					discriminator: "subject-1:role:Director",
					subjectEntityId: EntityId.make("subject-1"),
					properties: { role: "Director", associatedName: "Barbie", subjectName: "Greta Gerwig" },
				},
			]);
		}),
	));
