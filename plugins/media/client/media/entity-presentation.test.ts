import { createRyotClient } from "@ryot-app/client-sdk";
import { Effect, Result } from "@ryot-app/client-sdk/effect";
import type { EntityReference, EntityPresentationSource } from "@ryot-app/client-sdk/plugin";
import { describe, expect, it } from "vitest";

import { loadMediaPresentations, prepareMediaPresentations } from "./presentation";

const reference = (entityId: string): EntityReference => ({
	entityId,
	name: entityId,
	ownerPluginId: "media",
	populationStatus: "ready",
	translationStatus: "none",
	entitySchemaSlug: "person",
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
	populationStatus: "ready",
	translationStatus: "none",
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

		expect(Result.getOrThrow(result)).toEqual({
			one: {
				id: "one",
				rating: null,
				primary: null,
				image: managed,
				secondary: null,
				name: "Person one",
				schemaSlug: "person",
				batchAssets: [managed],
				populationStatus: "ready",
				translationStatus: "none",
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
				populationStatus: "ready",
				translationStatus: "none",
			},
		});
	});

	it("fails the batch when a saved-view source is missing", () => {
		expect(
			prepareMediaPresentations({ sources: new Map(), references: [reference("missing")] })._tag,
		).toBe("Failure");
	});

	it("loads one query batch when embedded presentation sources are unavailable", () => {
		const documents: unknown[] = [];
		const managed = { type: "s3", key: "portrait" } as const;
		const client = createRyotClient({
			uploadTemporary: () => Effect.succeed({}),
			query: (document) => {
				documents.push(document);
				return Effect.succeed({
					data: {
						presentation: { type: "rows", items: [source("one", managed), source("two", managed)] },
					},
				});
			},
		});

		const loaded = Effect.runSync(
			loadMediaPresentations({ client, references: [reference("one"), reference("two")] }),
		);

		expect(documents).toHaveLength(1);
		expect(loaded.one?.batchAssets).toEqual([managed]);
	});
});
