import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, recordsValue, stringValue } from "../../script-helpers/records";
import {
	bcp47ToTvdb,
	buildTranslationResult,
	getTranslationFields,
	tvdbGet,
	tvdbGetOptional,
} from "../tvdb-shared";

export const manifest = defineManifest({
	name: "TVDB",
	kind: "provider",
	slug: "movie-group.tvdb",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["tvdbApiKey"],
	requiredSystemConfigKeys: [],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: () => Effect.fail(new Error("TVDB does not support movie group search")),
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* Effect.fail(new Error("externalId must be a numeric TVDB list ID"));
			}
			const language = bcp47ToTvdb("en");
			const [payload, translationData] = yield* Effect.all(
				[
					tvdbGet(host, `/lists/${input.externalId}/extended`),
					tvdbGetOptional(host, `/lists/${input.externalId}/translations/${language}`),
				],
				{ concurrency: "unbounded" },
			);
			const list = asRecord(payload["data"]) ?? payload;
			const translation = getTranslationFields(translationData);
			const title = translation.name ?? stringValue(list["name"]) ?? "Unnamed List";
			const description = translation.description ?? stringValue(list["overview"]);
			const image = stringValue(list["image"]);
			const images = image ? [{ type: "remote" as const, url: image }] : [];
			const movieEntities = recordsValue(list["entities"]).filter(
				(entity) => entity["movieId"] != null,
			);
			const parts = movieEntities.length;
			const relatedEntities = [...movieEntities]
				.sort((a, b) => (numberValue(a["order"]) ?? 0) - (numberValue(b["order"]) ?? 0))
				.flatMap((entity, idx) => {
					const memberId = stringValue(entity["movieId"]);
					if (!memberId) {
						return [];
					}
					const memberName = stringValue(entity["name"]) ?? "Loading...";
					return [
						{
							name: memberName,
							externalId: memberId,
							providerSlug: "movie.tvdb",
							relationshipProperties: { order: idx + 1 },
						},
					];
				});
			const url = stringValue(list["url"]);
			const sourceUrl = url ? `https://thetvdb.com/lists/${url}` : null;
			return {
				name: title,
				properties: { parts, images, sourceUrl, description },
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						entities: relatedEntities,
						relationshipSchemaSlug: "movie-group-to-movie",
					},
				],
			};
		}),
});

export const translate = defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* Effect.fail(new Error("externalId must be a numeric TVDB list ID"));
			}
			const providerLanguage = bcp47ToTvdb(input.language);
			return yield* tvdbGetOptional(
				host,
				`/lists/${input.externalId}/translations/${providerLanguage}`,
			).pipe(Effect.map((translationData) => buildTranslationResult(translationData, null)));
		}),
});
