import type {
	AutomationPopulationContext,
	AutomationEntitySnapshot,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import {
	automationContext,
	entityRecord,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-entity-updated.sandbox";

type Population = typeof AutomationPopulationContext.Encoded;
type EntitySnapshot = typeof AutomationEntitySnapshot.Encoded;

const input = (
	overrides: {
		rootPreviouslyPopulated?: boolean;
		changedProperties?: string[];
		parentEntity?: NonNullable<Population["parentEntity"]>;
		after?: Partial<EntitySnapshot>;
		before?: Partial<EntitySnapshot>;
	} = {},
) => {
	const population: Population = {
		rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
		scopeEntity: { id: "show-1", name: "Severance", entitySchemaSlug: "show" },
		...(overrides.parentEntity ? { parentEntity: overrides.parentEntity } : {}),
	};
	return automationContext({
		population,
		category: "change",
		resource: "entity",
		operation: "update",
		changedProperties: overrides.changedProperties ?? [],
		after: entityRecord({
			id: "entity-1",
			properties: {},
			name: "New Name",
			entitySchemaSlug: "show",
			...overrides.after,
		}),
		before: entityRecord({
			id: "entity-1",
			properties: {},
			name: "Old Name",
			entitySchemaSlug: "show",
			...overrides.before,
		}),
	});
};

const run = (value: ReturnType<typeof input>) => {
	const calls: Array<Record<string, JsonValue | undefined>> = [];
	return definition
		.run(
			value,
			defineSandboxTestHost(manifest, {
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ wasCreated: true, triggerId: `signal-${calls.length}` });
				},
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		)
		.pipe(Effect.as(calls));
};

it("emits independent status, publish-year, and anime-count signals for a populated root", () =>
	run(
		input({
			after: {
				entitySchemaSlug: "anime",
				properties: { episodes: 13, publishYear: 2026, productionStatus: "Ended" },
			},
			before: {
				entitySchemaSlug: "anime",
				properties: { episodes: 12, publishYear: 2025, productionStatus: "Airing" },
			},
		}),
	).pipe(
		Effect.map((calls) => {
			expect(calls).toMatchObject([
				{ subjectEntityId: "show-1", schemaSlug: "media.status.changed" },
				{ subjectEntityId: "show-1", schemaSlug: "media.release-date.changed" },
				{ subjectEntityId: "show-1", schemaSlug: "media.content-count.changed" },
			]);
			expect(calls[2]?.["properties"]).toEqual({
				oldCount: 12,
				newCount: 13,
				entityName: "Severance",
				contentType: "episodes",
			});
			return undefined;
		}),
		Effect.runPromise,
	));

it("uses the parent show and season context for episode facts", () =>
	run(
		input({
			changedProperties: ["images"],
			parentEntity: {
				name: "Season 1",
				properties: { seasonNumber: 1 },
				entitySchemaSlug: "show-season",
			},
			before: {
				name: "Pilot",
				entitySchemaSlug: "show-episode",
				properties: {
					episodeNumber: 1,
					publishDate: "2026-01-01",
					images: [{ url: "old", type: "remote", purpose: "still" }],
				},
			},
			after: {
				name: "Premiere",
				entitySchemaSlug: "show-episode",
				properties: {
					episodeNumber: 1,
					publishDate: "2026-02-01",
					images: [{ url: "new", type: "remote", purpose: "still" }],
				},
			},
		}),
	).pipe(
		Effect.map((calls) => {
			expect(calls.map(({ schemaSlug }) => schemaSlug)).toEqual([
				"media.episode.name.changed",
				"media.episode.images.changed",
				"media.release-date.changed",
			]);
			expect(calls[0]?.["properties"]).toEqual({
				seasonNumber: 1,
				episodeNumber: 1,
				oldName: "Pilot",
				newName: "Premiere",
				entityName: "Severance",
			});
			return undefined;
		}),
		Effect.runPromise,
	));

it("does not treat a podcast parent as season context", () =>
	run(
		input({
			after: {
				name: "New Name",
				properties: { episodeNumber: 3 },
				entitySchemaSlug: "podcast-episode",
			},
			before: {
				name: "Old Name",
				properties: { episodeNumber: 3 },
				entitySchemaSlug: "podcast-episode",
			},
			parentEntity: {
				name: "Special Podcast",
				entitySchemaSlug: "podcast",
				properties: { seasonNumber: 0 },
			},
		}),
	).pipe(
		Effect.map((calls) => {
			expect(calls).toHaveLength(1);
			expect(calls[0]?.["properties"]).toEqual({
				episodeNumber: 3,
				oldName: "Old Name",
				newName: "New Name",
				entityName: "Severance",
			});
			return undefined;
		}),
		Effect.runPromise,
	));

it("stays silent for initial population and special seasons", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ rootPreviouslyPopulated: false })),
				run(
					input({
						after: {
							name: "New",
							properties: { episodeNumber: 1 },
							entitySchemaSlug: "show-episode",
						},
						before: {
							name: "Old",
							properties: { episodeNumber: 1 },
							entitySchemaSlug: "show-episode",
						},
						parentEntity: {
							name: "Season Zero",
							properties: { seasonNumber: 0 },
							entitySchemaSlug: "show-season",
						},
					}),
				),
				run(
					input({
						after: {
							name: "New",
							properties: { episodeNumber: 1 },
							entitySchemaSlug: "show-episode",
						},
						before: {
							name: "Old",
							properties: { episodeNumber: 1 },
							entitySchemaSlug: "show-episode",
						},
						parentEntity: {
							name: "Holiday Specials",
							properties: { seasonNumber: 2 },
							entitySchemaSlug: "show-season",
						},
					}),
				),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([initial, zero, namedSpecial]) => {
				expect(initial).toEqual([]);
				expect(zero).toEqual([]);
				expect(namedSpecial).toEqual([]);
				return undefined;
			}),
		),
	));
