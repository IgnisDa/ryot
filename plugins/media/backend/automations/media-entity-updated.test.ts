import { expect } from "bun:test";

import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { EntityId } from "@ryot-app/plugin-kit/schema";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import {
	automationContext,
	containmentRyotql,
	entityRecord,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-entity-updated.sandbox";

type EntitySnapshot = ReturnType<typeof entityRecord>;
type Population = typeof AutomationPopulationContext.Encoded;

const input = (
	overrides: {
		changedProperties?: string[];
		after?: Partial<EntitySnapshot>;
		before?: Partial<EntitySnapshot>;
		rootPreviouslyPopulated?: boolean;
		parentEntity?: NonNullable<Population["parentEntity"]>;
	} = {},
) => {
	const population: Population = {
		rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
		scopeEntity: {
			id: "show-1",
			name: "Severance",
			entitySchemaSlug: "show",
			entitySchemaPluginId: "media-owner",
		},
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

const execute = (
	value: ReturnType<typeof input>,
	containers: Readonly<Record<string, string>> = {},
) =>
	Effect.flatMap(value, (automation) =>
		definition.run(
			automation,
			defineSandboxTestHost(manifest, { executeRyotql: containmentRyotql(containers) }),
		),
	).pipe(Effect.map(({ changes }) => ({ folds: changes?.folds, signals: changes?.signals ?? [] })));

const run = (value: ReturnType<typeof input>) =>
	execute(value).pipe(Effect.map(({ signals }) => signals));

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
		Effect.map((signals) => {
			expect(signals).toMatchObject([
				{ subjectEntityId: "show-1", schemaSlug: "media.status.changed" },
				{ subjectEntityId: "show-1", schemaSlug: "media.release-date.changed" },
				{ subjectEntityId: "show-1", schemaSlug: "media.content-count.changed" },
			]);
			expect(signals[0]?.["properties"]).toEqual({
				newStatus: "Ended",
				oldStatus: "Airing",
				entityName: "Severance",
				entitySchemaSlug: "anime",
			});
			expect(signals[2]?.["properties"]).toEqual({
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
				entitySchemaPluginId: "media-owner",
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
		Effect.map((signals) => {
			expect(signals.map(({ schemaSlug }) => schemaSlug)).toEqual([
				"media.episode.name.changed",
				"media.episode.images.changed",
				"media.release-date.changed",
			]);
			expect(signals[0]?.["properties"]).toEqual({
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
				entitySchemaPluginId: "media-owner",
			},
		}),
	).pipe(
		Effect.map((signals) => {
			expect(signals).toHaveLength(1);
			expect(signals[0]?.["properties"]).toEqual({
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
							entitySchemaPluginId: "media-owner",
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
							entitySchemaPluginId: "media-owner",
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

it("refreshes library summaries of the population root, including on first population", () =>
	Effect.runPromise(
		Effect.all([
			execute(input({ after: { entitySchemaSlug: "show-episode" } })),
			execute(input({ rootPreviouslyPopulated: false })),
		]).pipe(
			Effect.map((results) => {
				expect(results.map(({ folds }) => folds)).toEqual([
					{ scope: "all-users", entityIds: [EntityId.make("show-1")] },
					{ scope: "all-users", entityIds: [EntityId.make("show-1")] },
				]);
			}),
		),
	));

it.effect(
	"refreshes the show of an episode updated without population context",
	() =>
		execute(
			automationContext({
				category: "change",
				resource: "entity",
				operation: "update",
				changedProperties: [],
				after: entityRecord({ id: "episode-1", entitySchemaSlug: "show-episode" }),
				before: entityRecord({ id: "episode-1", entitySchemaSlug: "show-episode" }),
			}),
			{ "season-1": "show-1", "episode-1": "season-1" },
		).pipe(
			Effect.map(({ folds, signals }) => {
				expect(folds).toEqual({ scope: "all-users", entityIds: [EntityId.make("show-1")] });
				expect(signals).toEqual([]);
			}),
		),
	testTimeout,
);
