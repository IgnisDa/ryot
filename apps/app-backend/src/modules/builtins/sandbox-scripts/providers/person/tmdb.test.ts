import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../test-utils";
import tmdbPersonScriptCode from "./tmdb.sandbox.js" with { type: "text" };

const runTmdbPersonDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(tmdbPersonScriptCode, context, hostFunctions, {
		metadata: { providerInformation: { canonicalLanguage: "en" } },
	});

describe("person.tmdb sandbox script", () => {
	it("emits separate movie and show credit groups with roles", () =>
		runTmdbPersonDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const url = String(args[1]);
					if (url.includes("/combined_credits")) {
						return httpSuccess({
							cast: [{ id: 2, media_type: "movie", title: "Film" }],
							crew: [{ id: 3, media_type: "tv", name: "Show", job: "Director" }],
						});
					}
					return httpSuccess({
						gender: 0,
						name: "Creator",
						also_known_as: [],
						profile_path: null,
						images: { profiles: [] },
					});
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-movie",
					entities: [
						{
							name: "Film",
							externalId: "2",
							scriptSlug: "movie.tmdb",
							relationshipProperties: { roles: ["Actor"] },
						},
					],
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "person-to-show",
					entities: [
						{
							name: "Show",
							externalId: "3",
							scriptSlug: "show.tmdb",
							relationshipProperties: { roles: ["Director"] },
						},
					],
				},
			]);
			return undefined;
		}));
});
