import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import { automationContext } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-relationship-sync.sandbox";

type Population = typeof AutomationPopulationContext.Encoded;

const input = (overrides: {
	isLeader?: boolean;
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
		scopeEntity: { id: "show-1", name: "Severance", entitySchemaSlug: "show" },
		batch: {
			id: "batch-1",
			updatedCount: 0,
			deletedCount: 0,
			isLeader: overrides.isLeader ?? true,
			afterCount: overrides.afterCount ?? 3,
			beforeCount: overrides.beforeCount ?? 2,
			createdCount: overrides.createdCount ?? 1,
		},
	};
	return automationContext({
		population,
		category: "change",
		operation: "create",
		resource: "relationship",
		after: {
			properties: {},
			id: "relationship-1",
			sourceEntityId: "source-1",
			targetEntityId: "target-1",
			createdAt: "2026-07-20T10:00:00.000Z",
			updatedAt: "2026-07-20T10:00:00.000Z",
			relationshipSchemaSlug: overrides.relationshipSchemaSlug ?? "show-to-show-season",
		},
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
					return Effect.succeed({ wasCreated: true, triggerId: "signal-1" });
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
			relationshipSchemaSlug: "show-season-to-show-episode",
			parentEntity: {
				name: "Season 2",
				properties: { seasonNumber: 2 },
				entitySchemaSlug: "show-season",
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

it("stays silent off-leader, on first population, without net changes, and for specials", () =>
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
						},
					}),
				),
			],
			{ concurrency: "unbounded" },
		).pipe(Effect.map((calls) => expect(calls).toEqual([[], [], [], [], []]))),
	));
