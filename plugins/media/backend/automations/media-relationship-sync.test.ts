import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { expect, it } from "vitest";

import {
	automationContext,
	containmentRyotql,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-relationship-sync.sandbox";

type Population = typeof AutomationPopulationContext.Encoded;

const input = (overrides: {
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
	const item = (id: string, isLeader: boolean) => ({
		category: "change",
		operation: "create",
		resource: "relationship",
		population: { ...population, batch: { ...population.batch, isLeader } },
		after: {
			id,
			properties: {},
			sourceEntityId: "source-1",
			targetEntityId: `target-${id}`,
			createdAt: "2026-07-20T10:00:00.000Z",
			updatedAt: "2026-07-20T10:00:00.000Z",
			relationshipSchemaPluginId: "media-owner",
			relationshipSchemaSlug: overrides.relationshipSchemaSlug ?? "show-to-show-season",
		},
	});
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
) => {
	const calls: Array<Record<string, JsonValue | undefined>> = [];
	const summaryRequests: Array<readonly string[]> = [];
	return definition
		.run(
			value,
			defineSandboxTestHost(manifest, {
				executeRyotql: containmentRyotql(containers),
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ wasCreated: true, triggerId: "signal-1" });
				},
				requestRelationshipProjectionsForAllUsers: (request) => {
					expect(request.relationshipSchemaSlug).toBe("in-media-library");
					summaryRequests.push(request.sourceEntityIds);
					return Effect.succeed({ users: 1 });
				},
			}),
		)
		.pipe(Effect.as({ calls, summaryRequests }));
};

const run = (value: ReturnType<typeof input>) =>
	execute(value).pipe(Effect.map(({ calls }) => calls));

it("emits one season-count signal from the batch leader on a net count change", () =>
	Effect.runPromise(
		run(input({})).pipe(
			Effect.map((calls) => {
				expect(calls).toEqual([
					{
						discriminator: "batch-1",
						subjectEntityId: "show-1",
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
			Effect.map((calls) => {
				expect(calls.map(({ discriminator }) => discriminator)).toEqual(["batch-1"]);
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
		Effect.map((calls) => {
			expect(calls[0]).toMatchObject({
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
		Effect.map((calls) => {
			expect(calls[0]?.["properties"]).toEqual({
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
		).pipe(Effect.map((calls) => expect(calls).toEqual([[], [], [], [], []]))),
	));

it("refreshes library summaries of the population root, including on first population", () =>
	Effect.runPromise(
		Effect.all([
			execute(input({ followers: 1 })),
			execute(input({ rootPreviouslyPopulated: false })),
		]).pipe(
			Effect.map((results) => {
				expect(results.map(({ summaryRequests }) => summaryRequests)).toEqual([
					[["show-1"]],
					[["show-1"]],
				]);
			}),
		),
	));

it("refreshes the show of an episode linked without population context", () =>
	Effect.runPromise(
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
			Effect.map(({ calls, summaryRequests }) => {
				expect(summaryRequests).toEqual([["show-1"]]);
				expect(calls).toEqual([]);
			}),
		),
	));
