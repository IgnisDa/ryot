import { RelationshipSchemaId } from "@ryot/contract/schema/brands";
import { assert, describe, expect, it } from "vitest";

import { parseAppSchemaPropertiesSafe } from "#lib/property-schema/property-schema-runtime";

import { builtinSignalSchemas } from "./signal-schemas";

const schemas = builtinSignalSchemas(RelationshipSchemaId.make("media-monitoring"));

const validate = (slug: string, properties: unknown) => {
	const schema = schemas.find((candidate) => candidate.slug === slug);
	assert(schema);
	return parseAppSchemaPropertiesSafe({ properties, propertiesSchema: schema.propertiesSchema });
};

describe("media signal property contracts", () => {
	it("requires the fields for each release-date variant and permits podcast-shaped episode dates", () => {
		expect(
			validate("media.release-date.changed", {
				oldYear: 2025,
				newYear: 2026,
				entityName: "Movie",
				changeKind: "publish_year",
			}).success,
		).toBe(true);
		expect(
			validate("media.release-date.changed", {
				episodeNumber: 12,
				oldDate: "2026-01-01",
				newDate: "2026-01-02",
				entityName: "Podcast",
				changeKind: "episode_date",
			}).success,
		).toBe(true);
		expect(
			validate("media.release-date.changed", {
				oldYear: 2025,
				entityName: "Movie",
				changeKind: "publish_year",
			}).success,
		).toBe(false);
	});

	it("accepts nullable episode-name transitions and rejects unknown fields", () => {
		expect(
			validate("media.episode.name.changed", {
				oldName: null,
				newName: "Pilot",
				episodeNumber: 1,
				entityName: "Show",
			}).success,
		).toBe(true);
		expect(
			validate("media.episode.images.changed", {
				images: [],
				episodeNumber: 1,
				entityName: "Show",
			}).success,
		).toBe(false);
	});

	it("accepts fractional manga content counts", () => {
		expect(
			validate("media.content-count.changed", {
				oldCount: 100.5,
				newCount: 101.5,
				entityName: "Manga",
				contentType: "chapters",
			}).success,
		).toBe(true);
	});
});
