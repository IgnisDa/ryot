import type { JsonValue } from "@ryot/sandbox-sdk";
import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./media-entity-updated.sandbox";

const input = (
	overrides: {
		rootPreviouslyPopulated?: boolean;
		owningSeason?: { name: string | null; number: number | null };
		after?: Partial<
			NonNullable<Extract<AutomationInput["automation"]["source"], { kind: "entity" }>["after"]>
		>;
		before?: Partial<
			NonNullable<Extract<AutomationInput["automation"]["source"], { kind: "entity" }>["before"]>
		>;
	} = {},
): AutomationInput => ({
	automation: {
		ruleId: "rule-1",
		operation: "update",
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
		},
		source: {
			kind: "entity",
			before: {
				id: "entity-1",
				properties: {},
				name: "Old Name",
				entitySchemaSlug: "show",
				entitySchemaId: "entity-schema",
				...overrides.before,
			},
			after: {
				id: "entity-1",
				properties: {},
				name: "New Name",
				entitySchemaSlug: "show",
				entitySchemaId: "entity-schema",
				...overrides.after,
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
				return Promise.resolve({
					success: true,
					data: { wasCreated: true, signalId: `signal-${calls.length}` },
				});
			},
		}),
		{ metadata: {}, sandboxScriptId: "script-1" },
	).then(() => calls);
};

it("emits independent status, publish-year, and anime-count signals for a populated root", () =>
	run(
		input({
			before: {
				entitySchemaSlug: "anime",
				properties: { episodes: 12, publishYear: 2025, productionStatus: "Airing" },
			},
			after: {
				entitySchemaSlug: "anime",
				properties: { episodes: 13, publishYear: 2026, productionStatus: "Ended" },
			},
		}),
	).then((calls) => {
		expect(calls).toMatchObject([
			{ schemaSlug: "media.status.changed", subjectEntityId: "show-1" },
			{ schemaSlug: "media.release-date.changed", subjectEntityId: "show-1" },
			{ schemaSlug: "media.content-count.changed", subjectEntityId: "show-1" },
		]);
		expect(calls[2]?.["properties"]).toEqual({
			oldCount: 12,
			newCount: 13,
			entityName: "Severance",
			contentType: "episodes",
		});
		return undefined;
	}));

it("uses the parent show and owning season for episode facts", () =>
	run(
		input({
			owningSeason: { name: "Season 1", number: 1 },
			before: {
				name: "Pilot",
				entitySchemaSlug: "show-episode",
				properties: {
					episodeNumber: 1,
					publishDate: "2026-01-01",
					images: [{ type: "remote", url: "old" }],
				},
			},
			after: {
				name: "Premiere",
				entitySchemaSlug: "show-episode",
				properties: {
					episodeNumber: 1,
					publishDate: "2026-02-01",
					images: [{ type: "remote", url: "new" }],
				},
			},
		}),
	).then((calls) => {
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
	}));

it("stays silent for initial population and special seasons", () =>
	Promise.all([
		run(input({ rootPreviouslyPopulated: false })),
		run(
			input({
				owningSeason: { name: "Specials", number: 0 },
				before: {
					name: "Old",
					properties: { episodeNumber: 1 },
					entitySchemaSlug: "show-episode",
				},
				after: {
					name: "New",
					properties: { episodeNumber: 1 },
					entitySchemaSlug: "show-episode",
				},
			}),
		),
	]).then(([initial, special]) => {
		expect(initial).toEqual([]);
		expect(special).toEqual([]);
		return undefined;
	}));

it("treats image order and duplicates as equal and ignores null-sided dates", () =>
	run(
		input({
			owningSeason: { name: "Season 1", number: 1 },
			before: {
				name: "Episode",
				entitySchemaSlug: "show-episode",
				properties: {
					episodeNumber: 1,
					publishDate: null,
					images: [
						{ url: "a", type: "remote" },
						{ url: "b", type: "remote" },
					],
				},
			},
			after: {
				name: "Episode",
				entitySchemaSlug: "show-episode",
				properties: {
					episodeNumber: 1,
					publishDate: "2026-01-01",
					images: [
						{ type: "remote", url: "b" },
						{ type: "remote", url: "a" },
						{ type: "remote", url: "a" },
					],
				},
			},
		}),
	).then((calls) => expect(calls).toEqual([])));
