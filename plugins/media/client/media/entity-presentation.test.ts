import { describe, expect, it } from "bun:test";

import { Result } from "@ryot-app/plugin-client-sdk/effect";
import type { EntityPresentationSource, EntityReference } from "@ryot-app/plugin-client-sdk/plugin";

import { mediaPlugin } from "../../manifest/plugin";
import { mediaEntityPresentation } from "./entity-presentation";
import { prepareMediaPresentations } from "./presentation";

const reference = (entityId: string): EntityReference => ({
	entityId,
	name: entityId,
	ownerPluginId: "media",
	entitySchemaSlug: "person",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
});

const source = (
	id: string,
	image: EntityPresentationSource["image"],
): EntityPresentationSource => ({
	id,
	image,
	rating: null,
	primary: null,
	secondary: null,
	name: `Person ${id}`,
	schemaSlug: "person",
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
});

describe("media entity presentation preparation", () => {
	it("decodes saved-view rows and shares one deduplicated managed asset batch", () => {
		const managed = { type: "s3", key: "portrait" } as const;
		const result = prepareMediaPresentations({
			references: [reference("one"), reference("two")],
			sources: new Map([
				["one", source("one", managed)],
				["two", source("two", managed)],
			]),
		});

		expect(Result.getOrThrow(result)).toEqual<unknown>({
			one: {
				id: "one",
				rating: null,
				primary: null,
				image: managed,
				secondary: null,
				name: "Person one",
				schemaSlug: "person",
				batchAssets: [managed],
				translationStatus: { state: "idle", availability: "none" },
				populationStatus: { state: "succeeded", availability: "complete" },
				relatedPopulationStatus: { state: "succeeded", availability: "complete" },
			},
			two: {
				id: "two",
				rating: null,
				primary: null,
				image: managed,
				secondary: null,
				name: "Person two",
				schemaSlug: "person",
				batchAssets: [managed],
				translationStatus: { state: "idle", availability: "none" },
				populationStatus: { state: "succeeded", availability: "complete" },
				relatedPopulationStatus: { state: "succeeded", availability: "complete" },
			},
		});
	});

	it("fails the batch when a saved-view source is missing", () => {
		expect(
			prepareMediaPresentations({ sources: new Map(), references: [reference("missing")] })._tag,
		).toBe("Failure");
	});
});

it("prepares public cards for every media schema without private progress or ratings", () => {
	for (const schemaSlug of Object.keys(mediaPlugin.client.entities)) {
		const { rating: _rating, ...data } = source("one", { type: "local", key: "poster" });
		const result = Result.getOrThrow(
			mediaEntityPresentation("poster", "grid").prepare({
				sources: new Map([["one", { ...data, schemaSlug }]]),
				references: [{ ...reference("one"), entitySchemaSlug: schemaSlug }],
			}),
		);
		expect(result["one"]).toMatchObject({
			id: "one",
			schemaSlug,
			image: { type: "local", key: "poster" },
		});
		expect(result["one"]).not.toHaveProperty("rating");
	}
});
