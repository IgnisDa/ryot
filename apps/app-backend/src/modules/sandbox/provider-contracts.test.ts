import { expect, it } from "@effect/vitest";
import { Schema as SandboxSchema } from "@ryot/sandbox-sdk/effect";
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

const decodeSdkSearch = SandboxSchema.decodeUnknownEffect(providerSearchResultSchema);
const decodeSdkDetails = SandboxSchema.decodeUnknownEffect(providerDetailsResultSchema);
const decodeSdkResolve = SandboxSchema.decodeUnknownEffect(providerResolveResultSchema);
const decodeSdkTranslate = SandboxSchema.decodeUnknownEffect(providerTranslateResultSchema);

it.effect("keeps Effect provider decoders in parity with SDK encoded results", () =>
	Effect.gen(function* () {
		const rawSearch = {
			items: [
				{
					title: " Show ",
					externalId: " show-1 ",
					metadata: [" 2024 ", 2024],
					imageUrl: " https://images.test/show.jpg ",
				},
			],
		};
		expect(yield* decodeProviderSearchResult(rawSearch)).toEqual(yield* decodeSdkSearch(rawSearch));
		const excessSearch = {
			items: [{ extra: true, externalId: "show-1", title: "Show" }],
		};
		expect((yield* Effect.exit(decodeSdkSearch(excessSearch)))._tag).toBe("Failure");
		expect((yield* Effect.exit(decodeProviderSearchResult(excessSearch)))._tag).toBe("Failure");

		const search = yield* decodeSdkSearch({
			details: { totalItems: 1, nextPage: null },
			items: [
				{
					title: "Show",
					externalId: "show-1",
					metadata: ["Author", 2024],
					imageUrl: "https://images.test/show.jpg",
				},
			],
		});
		const details = yield* decodeSdkDetails({
			name: "Show",
			properties: { year: 2024 },
			expectedChildEntitySchemaSlug: "show-season",
			childEntities: [
				{
					name: "Season 1",
					externalId: "season-1",
					properties: { number: 1 },
					entitySchemaSlug: "show-season",
					expectedChildEntitySchemaSlug: "show-episode",
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
							providerSlug: "tmdb",
							externalId: "person-1",
							relationshipProperties: { roles: ["Creator"] },
						},
					],
				},
			],
		});
		const resolve = yield* decodeSdkResolve({ externalId: null });
		const translate = yield* decodeSdkTranslate({
			name: "Localized",
			properties: { description: "Translated" },
		});

		expect(yield* decodeProviderSearchResult(search)).toEqual(search);
		expect(yield* decodeProviderDetailsResult(details)).toEqual(details);
		expect(yield* decodeProviderResolveResult(resolve)).toEqual(resolve);
		expect(yield* decodeProviderTranslateResult(translate)).toEqual(translate);
	}),
);
