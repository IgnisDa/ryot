import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import {
	defineProvider,
	defineProviderDriver,
	providerDetailsResultSchema,
	providerResolveResultSchema,
	providerSearchResultSchema,
	providerTranslateResultSchema,
} from "@ryot/sandbox-sdk/provider";
import { describe, expect, test } from "vitest";

import { defineManifest, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";

const decode = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownSync(schema);
const manifest = defineManifest({
	kind: "provider",
	name: "Test provider",
	slug: "test.provider",
	requiredAppConfigKeys: [],
	capabilities: ["getCachedValue"],
	providerInformation: { source: "test", canonicalLanguage: "en" },
});

describe("provider definitions", () => {
	test("provides standard driver schemas and a provider definition", () => {
		const resolve = defineProviderDriver(manifest, "resolve", (input) =>
			Effect.succeed({ externalId: input.value === "known" ? "provider-1" : null }),
		);
		const definition = defineProvider({ manifest, drivers: { resolve } });

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(
			decode(definition.drivers.resolve.input)({ identifierType: "isbn", value: "known" }),
		).toEqual({ identifierType: "isbn", value: "known" });
	});
});

describe("provider result contracts", () => {
	test("validates search, recursive details, resolve, and translation values", () => {
		expect(
			decode(providerSearchResultSchema)({
				items: [
					{
						externalId: "show-1",
						titleProperty: { kind: "text", value: "Show" },
						primarySubtitleProperty: { kind: "number", value: 2024 },
					},
				],
			}),
		).toEqual({
			items: [
				{
					externalId: "show-1",
					titleProperty: { kind: "text", value: "Show" },
					primarySubtitleProperty: { kind: "number", value: 2024 },
				},
			],
		});
		expect(
			decode(providerDetailsResultSchema)({
				name: "Show",
				properties: { year: 2024 },
				childEntities: [
					{
						name: "Season 1",
						externalId: "season-1",
						properties: { number: 1 },
						entitySchemaSlug: "show-season",
						childEntities: [
							{
								name: "Episode 1",
								externalId: "episode-1",
								properties: { number: 1 },
								entitySchemaSlug: "show-episode",
							},
						],
					},
				],
				relatedEntityGroups: [
					{
						direction: "incoming",
						synchronization: "additive",
						relationshipSchemaSlug: "person-to-show",
						entities: [{ name: "Creator", externalId: "person-1", scriptSlug: "person.test" }],
					},
				],
			}),
		).toMatchObject({ name: "Show" });
		expect(decode(providerResolveResultSchema)({ externalId: null })).toEqual({ externalId: null });
		expect(
			decode(providerTranslateResultSchema)({
				name: "Localized",
				properties: { description: "Translated" },
			}),
		).toEqual({ name: "Localized", properties: { description: "Translated" } });
	});
});
