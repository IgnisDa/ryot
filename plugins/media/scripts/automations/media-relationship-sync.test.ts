import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { expect, it } from "vitest";

import definition, { manifest } from "./media-relationship-sync.sandbox";

type Population = NonNullable<AutomationInput["automation"]["population"]>;

const input = (overrides: {
	isLeader?: boolean;
	afterCount?: number;
	beforeCount?: number;
	createdCount?: number;
	relationshipSchemaSlug?: string;
	rootPreviouslyPopulated?: boolean;
	parentEntity?: NonNullable<Population["parentEntity"]>;
}): AutomationInput => ({
	automation: {
		ruleId: "rule-1",
		operation: "create",
		occurrenceId: "occurrence-1",
		origin: { kind: "provider_refresh" },
		occurredAt: "2026-07-20T10:00:00.000Z",
		population: {
			rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
			...(overrides.parentEntity ? { parentEntity: overrides.parentEntity } : {}),
			scopeEntity: {
				id: "show-1",
				name: "Severance",
				entitySchemaSlug: "show",
			},
			batch: {
				id: "batch-1",
				updatedCount: 0,
				deletedCount: 0,
				isLeader: overrides.isLeader ?? true,
				afterCount: overrides.afterCount ?? 3,
				beforeCount: overrides.beforeCount ?? 2,
				createdCount: overrides.createdCount ?? 1,
			},
		},
		source: {
			kind: "relationship",
			after: {
				properties: {},
				id: "relationship-1",
				source: { id: "source-1", name: "Source", entitySchemaSlug: "show" },
				target: { id: "target-1", name: "Target", entitySchemaSlug: "show-season" },
				relationshipSchemaSlug: overrides.relationshipSchemaSlug ?? "show-to-show-season",
			},
		},
	},
});

const run = (value: AutomationInput) => {
	const calls: Array<Record<string, JsonValue | undefined>> = [];
	return definition
		.run(
			value,
			defineSandboxTestHost(manifest, {
				emitSignal: (request) => {
					calls.push(request);
					return Effect.succeed({ wasCreated: true, signalId: "signal-1" });
				},
			}),
			{ metadata: {}, sandboxScriptId: "script-1" },
		)
		.pipe(Effect.as(calls));
};

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

it("emits aggregate episode discovery with the created count and season", () =>
	run(
		input({
			afterCount: 5,
			beforeCount: 2,
			createdCount: 3,
			parentEntity: {
				name: "Season 2",
				properties: { seasonNumber: 2 },
				entitySchemaSlug: "show-season",
			},
			relationshipSchemaSlug: "show-season-to-show-episode",
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
			parentEntity: {
				name: "Special Podcast",
				properties: { seasonNumber: 0 },
				entitySchemaSlug: "podcast",
			},
			relationshipSchemaSlug: "podcast-to-podcast-episode",
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

it("stays silent off-leader, on first population, without net changes, and for specials", () =>
	Effect.runPromise(
		Effect.all(
			[
				run(input({ isLeader: false })),
				run(input({ rootPreviouslyPopulated: false })),
				run(input({ afterCount: 2, beforeCount: 2 })),
				run(
					input({
						parentEntity: {
							name: "Season Zero",
							properties: { seasonNumber: 0 },
							entitySchemaSlug: "show-season",
						},
						relationshipSchemaSlug: "show-season-to-show-episode",
					}),
				),
				run(
					input({
						parentEntity: {
							name: "Bonus Specials Collection",
							properties: { seasonNumber: 2 },
							entitySchemaSlug: "show-season",
						},
						relationshipSchemaSlug: "show-season-to-show-episode",
					}),
				),
			],
			{ concurrency: "unbounded" },
		).pipe(Effect.map((calls) => expect(calls).toEqual([[], [], [], [], []]))),
	));
