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
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-relationship-sync.sandbox";

type Population = typeof AutomationPopulationContext.Encoded;

const input = (overrides: {
	update?: boolean;
	isLeader?: boolean;
	followers?: number;
	afterCount?: number;
	beforeCount?: number;
	createdCount?: number;
	relationshipSchemaSlug?: string;
	rootPreviouslyPopulated?: boolean;
	parentEntity?: NonNullable<Population["parentEntity"]>;
}) => {
	const population: Population = {
		rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
		...(overrides.parentEntity ? { parentEntity: overrides.parentEntity } : {}),
		scopeEntity: {
			id: "show-1",
			name: "Severance",
			entitySchemaSlug: "show",
			entitySchemaPluginId: "media-owner",
		},
		batch: {
			id: "batch-1",
			isLeader: true,
			updatedCount: 0,
			deletedCount: 0,
			afterCount: overrides.afterCount ?? 3,
			beforeCount: overrides.beforeCount ?? 2,
			createdCount: overrides.createdCount ?? 1,
		},
	};
	const item = (id: string, isLeader: boolean) => {
		const snapshot = {
			id,
			properties: {},
			sourceEntityId: "source-1",
			targetEntityId: `target-${id}`,
			createdAt: "2026-07-20T10:00:00.000Z",
			updatedAt: "2026-07-20T10:00:00.000Z",
			relationshipSchemaPluginId: "media-owner",
			relationshipSchemaSlug: overrides.relationshipSchemaSlug ?? "show-to-show-season",
		};
		return {
			category: "change",
			resource: "relationship",
			population: { ...population, batch: { ...population.batch, isLeader } },
			...(overrides.update
				? { after: snapshot, before: snapshot, operation: "update", changedProperties: [] }
				: { after: snapshot, operation: "create" }),
		};
	};
	return automationContext({
		category: "change",
		operation: "batch",
		resource: "relationship",
		items: [
			item("relationship-1", overrides.isLeader ?? true),
			...((overrides.followers ?? 0) ? [item("relationship-2", false)] : []),
		],
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

it("emits one season-count signal from the batch leader on a net count change", () =>
	Effect.runPromise(
		run(input({})).pipe(
			Effect.map((signals) => {
				expect(signals).toEqual([
					{
						discriminator: "batch-1",
						subjectEntityId: EntityId.make("show-1"),
						schemaSlug: "media.season-count.changed",
						properties: { oldCount: 2, newCount: 3, entityName: "Severance" },
					},
				]);
				return undefined;
			}),
		),
	));

it("emits once for a batch that carries the leader alongside other items", () =>
	Effect.runPromise(
		run(input({ followers: 1 })).pipe(
			Effect.map((signals) => {
				expect(signals.map(({ discriminator }) => discriminator)).toEqual(["batch-1"]);
				return undefined;
			}),
		),
	));

it("emits aggregate episode discovery with the created count and season", () =>
	run(
		input({
			afterCount: 5,
			beforeCount: 2,
			createdCount: 3,
			relationshipSchemaSlug: "show-season-to-show-episode",
			parentEntity: {
				name: "Season 2",
				properties: { seasonNumber: 2 },
				entitySchemaSlug: "show-season",
				entitySchemaPluginId: "media-owner",
			},
		}),
	).pipe(
		Effect.map((signals) => {
			expect(signals[0]).toMatchObject({
				schemaSlug: "media.episode.discovered",
				properties: {
					newCount: 5,
					oldCount: 2,
					seasonNumber: 2,
					discoveredCount: 3,
					entityName: "Severance",
				},
			});
			return undefined;
		}),
		Effect.runPromise,
	));

it("does not treat a podcast parent as season context", () =>
	run(
		input({
			relationshipSchemaSlug: "podcast-to-podcast-episode",
			parentEntity: {
				name: "Special Podcast",
				entitySchemaSlug: "podcast",
				properties: { seasonNumber: 0 },
				entitySchemaPluginId: "media-owner",
			},
		}),
	).pipe(
		Effect.map((signals) => {
			expect(signals[0]?.["properties"]).toEqual({
				oldCount: 2,
				newCount: 3,
				discoveredCount: 1,
				entityName: "Severance",
			});
			return undefined;
		}),
		Effect.runPromise,
	));

it("stays silent without the leader, on first population, without net changes, and for specials", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ isLeader: false })),
				run(input({ rootPreviouslyPopulated: false })),
				run(input({ afterCount: 2, beforeCount: 2 })),
				run(
					input({
						relationshipSchemaSlug: "show-season-to-show-episode",
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
						relationshipSchemaSlug: "show-season-to-show-episode",
						parentEntity: {
							properties: { seasonNumber: 2 },
							entitySchemaSlug: "show-season",
							name: "Bonus Specials Collection",
							entitySchemaPluginId: "media-owner",
						},
					}),
				),
			],
			{ concurrency: "unbounded" },
		).pipe(Effect.map((signals) => expect(signals).toEqual([[], [], [], [], []]))),
	));

it("refreshes library summaries of the population root when links are created, including on first population, and not when they are only updated", () =>
	Effect.runPromise(
		Effect.all([
			execute(input({ followers: 1 })),
			execute(input({ rootPreviouslyPopulated: false })),
			execute(input({ update: true, followers: 1 })),
		]).pipe(
			Effect.map((results) => {
				expect(results.map(({ folds }) => folds)).toEqual([
					{ scope: "all-users", entityIds: [EntityId.make("show-1")] },
					{ scope: "all-users", entityIds: [EntityId.make("show-1")] },
					undefined,
				]);
			}),
		),
	));

it.effect(
	"refreshes the show of an episode linked without population context",
	() =>
		execute(
			automationContext({
				category: "change",
				operation: "batch",
				resource: "relationship",
				items: [
					{
						category: "change",
						operation: "create",
						resource: "relationship",
						after: {
							properties: {},
							id: "relationship-1",
							sourceEntityId: "season-1",
							targetEntityId: "episode-1",
							createdAt: "2026-07-20T10:00:00.000Z",
							updatedAt: "2026-07-20T10:00:00.000Z",
							relationshipSchemaPluginId: "media-owner",
							relationshipSchemaSlug: "show-season-to-show-episode",
						},
					},
				],
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
