import { expect, it } from "@effect/vitest";
import {
	providerDetailsResultSchema,
	providerResolveResultSchema,
	providerSearchResultSchema,
	providerTranslateResultSchema,
} from "@ryot/sandbox-sdk/provider";
import { Effect } from "effect";

import {
	decodeProviderDetailsResult,
	decodeProviderResolveResult,
	decodeProviderSearchResult,
	decodeProviderTranslateResult,
} from "./provider-contracts";

it.effect("keeps Effect provider decoders in parity with SDK encoded results", () =>
	Effect.gen(function* () {
		const rawSearch = {
			items: [{ externalId: " show-1 ", titleProperty: { kind: "text", value: " Show " } }],
		};
		expect(yield* decodeProviderSearchResult(rawSearch)).toEqual(
			providerSearchResultSchema.parse(rawSearch),
		);
		const excessSearch = {
			items: [
				{ extra: true, externalId: "show-1", titleProperty: { kind: "text", value: "Show" } },
			],
		};
		expect(providerSearchResultSchema.safeParse(excessSearch).success).toBe(false);
		expect((yield* Effect.exit(decodeProviderSearchResult(excessSearch)))._tag).toBe("Failure");

		const search = providerSearchResultSchema.parse({
			details: { totalItems: 1, nextPage: null },
			items: [
				{
					externalId: "show-1",
					imageProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Show" },
					primarySubtitleProperty: { kind: "number", value: 2024 },
				},
			],
		});
		const details = providerDetailsResultSchema.parse({
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
					entities: [
						{
							name: "Creator",
							externalId: "person-1",
							scriptSlug: "person.tmdb",
							relationshipProperties: { roles: ["Creator"] },
						},
					],
				},
			],
		});
		const resolve = providerResolveResultSchema.parse({ externalId: null });
		const translate = providerTranslateResultSchema.parse({
			name: "Localized",
			properties: { description: "Translated" },
		});

		expect(yield* decodeProviderSearchResult(search)).toEqual(search);
		expect(yield* decodeProviderDetailsResult(details)).toEqual(details);
		expect(yield* decodeProviderResolveResult(resolve)).toEqual(resolve);
		expect(yield* decodeProviderTranslateResult(translate)).toEqual(translate);
	}),
);
