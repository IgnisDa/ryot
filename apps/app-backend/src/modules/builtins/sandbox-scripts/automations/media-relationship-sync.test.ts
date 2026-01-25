import type { JsonValue } from "@ryot/sandbox-sdk";
import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./media-relationship-sync.sandbox";

const input = (overrides: {
	isLeader?: boolean;
	afterCount?: number;
	beforeCount?: number;
	createdCount?: number;
	relationshipSchemaSlug?: string;
	rootPreviouslyPopulated?: boolean;
	owningSeason?: { name: string | null; number: number | null };
}): AutomationInput => ({
	automation: {
		ruleId: "rule-1",
		operation: "create",
		occurrenceId: "occurrence-1",
		origin: { kind: "provider_refresh" },
		occurredAt: "2026-07-20T10:00:00.000Z",
		population: {
			rootPreviouslyPopulated: overrides.rootPreviouslyPopulated ?? true,
			...(overrides.owningSeason ? { owningSeason: overrides.owningSeason } : {}),
			scopeEntity: {
				id: "show-1",
				name: "Severance",
				entitySchemaSlug: "show",
				entitySchemaId: "show-schema",
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
				relationshipSchemaId: "relationship-schema-1",
				source: { id: "source-1", name: "Source", entitySchemaSlug: "show" },
				target: { id: "target-1", name: "Target", entitySchemaSlug: "show-season" },
				relationshipSchemaSlug: overrides.relationshipSchemaSlug ?? "show-to-show-season",
			},
		},
	},
});

const run = (value: AutomationInput) => {
	const calls: Array<Record<string, JsonValue | undefined>> = [];
	return runSandboxTestDriver(
		definition.drivers.automation,
		value,
		defineSandboxTestHost(manifest, {
			emitSignal: (request) => {
				calls.push(request);
				return Promise.resolve({ success: true, data: { wasCreated: true, signalId: "signal-1" } });
			},
		}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	).then(() => calls);
};

it("emits one season-count signal from the batch leader on a net count change", () =>
	run(input({})).then((calls) => {
		expect(calls).toEqual([
			{
				discriminator: "batch-1",
				subjectEntityId: "show-1",
				schemaSlug: "media.season-count.changed",
				properties: { oldCount: 2, newCount: 3, entityName: "Severance" },
			},
		]);
		return undefined;
	}));

it("emits aggregate episode discovery with the created count and season", () =>
	run(
		input({
			afterCount: 5,
			beforeCount: 2,
			createdCount: 3,
			owningSeason: { name: "Season 2", number: 2 },
			relationshipSchemaSlug: "show-season-to-show-episode",
		}),
	).then((calls) => {
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
	}));

it("stays silent off-leader, on first population, without net changes, and for specials", () =>
	Promise.all([
		run(input({ isLeader: false })),
		run(input({ rootPreviouslyPopulated: false })),
		run(input({ afterCount: 2, beforeCount: 2 })),
		run(
			input({
				owningSeason: { name: "Specials", number: 0 },
				relationshipSchemaSlug: "show-season-to-show-episode",
			}),
		),
	]).then((calls) => expect(calls).toEqual([[], [], [], []])));
