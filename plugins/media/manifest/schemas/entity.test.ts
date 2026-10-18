import { parseAppSchemaPropertiesSafe } from "@ryot-app/contract/schema/property-values";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { describe, expect, it } from "vitest";

import {
	mediaActivityDeclaredProperties,
	mediaActivityEntitySchemaSlugs,
	mediaActivityEventSchemaSlugs,
	mediaReviewDeclaredProperties,
} from "../../shared/media-activity-fields";
import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { mediaEntitySchemas } from "./entity";

const propertiesSchemaOf = (entity: string, event: string) => {
	const propertiesSchema = mediaEntitySchemas()
		.find((schema) => schema.slug === entity)
		?.eventSchemas.find((schema) => schema.slug === event)?.propertiesSchema;
	if (propertiesSchema === undefined) {
		throw new Error(`Missing ${entity} ${event} event schema`);
	}
	return propertiesSchema;
};

const accepts = (entity: string, event: string, properties: Record<string, unknown>) =>
	parseAppSchemaPropertiesSafe({ properties, propertiesSchema: propertiesSchemaOf(entity, event) })
		.success;

describe("media lifecycle event schemas", () => {
	it.each(["progress", "dropped", "on_hold"])(
		"accepts a book %s event without a progress percent",
		(event) => {
			expect(accepts("book", event, {})).toBe(true);
			expect(accepts("book", event, { progressPercent: 40 })).toBe(true);
			expect(accepts("book", event, { progressPercent: 0 })).toBe(false);
			expect(accepts("book", event, { progressPercent: 101 })).toBe(false);
		},
	);

	it.each(["show", "podcast"])(
		"accepts a %s dropped or on-hold event with no progress",
		(entity) => {
			expect(accepts(entity, "dropped", {})).toBe(true);
			expect(accepts(entity, "on_hold", { startedOn: "2026-01-01T00:00:00.000Z" })).toBe(true);
		},
	);

	it("records anime and manga positions without a percent", () => {
		expect(accepts("anime", "progress", { animeEpisode: 12 })).toBe(true);
		expect(accepts("manga", "progress", { mangaChapter: 12.5 })).toBe(true);
		expect(accepts("manga", "progress", { mangaVolume: 2, mangaChapter: 12 })).toBe(true);
		expect(accepts("manga", "list-state", validListState({ mangaChapter: 12.5 }))).toBe(true);
		expect(accepts("manga", "list-state", validListState({ mangaChapter: -1 }))).toBe(false);
	});

	it("accepts a completion with an optional unknown-date flag", () => {
		expect(accepts("book", "complete", {})).toBe(true);
		expect(accepts("book", "complete", { dateUnknown: true })).toBe(true);
	});
});

const validListState = (overrides: Record<string, unknown>) => ({
	repeatCount: 0,
	source: "anilist",
	sourceEntryId: "1",
	state: "in_progress",
	sourceAccountId: "1",
	sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

const declaredFields = (entity: string, event: string) => {
	const fields = mediaEntitySchemas()
		.find((schema) => schema.slug === entity)
		?.eventSchemas.find((schema) => schema.slug === event)?.propertiesSchema.fields;
	return fields === undefined ? undefined : sortBy(Object.keys(fields));
};

describe("media activity edit field matrix", () => {
	it("matches the manifest's declared lifecycle event properties", () => {
		for (const entity of mediaActivityEntitySchemaSlugs) {
			for (const event of mediaActivityEventSchemaSlugs) {
				const declared = mediaActivityDeclaredProperties(entity, event);
				expect(declared === undefined ? undefined : sortBy(declared), `${entity} ${event}`).toEqual(
					declaredFields(entity, event),
				);
			}
		}
	});

	it("matches the manifest's declared review properties", () => {
		for (const entity of mediaLibraryMemberEntitySchemaSlugs) {
			expect(sortBy(mediaReviewDeclaredProperties(entity)), entity).toEqual(
				declaredFields(entity, "review"),
			);
		}
	});
});
