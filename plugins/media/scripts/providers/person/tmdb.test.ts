import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./tmdb";

type TmdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("token"),
		getUserPreferences: () => Effect.succeed({ isNsfw: false, disableIntegrations: false }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.tmdb sandbox script", () => {
	it("emits separate movie and show credit groups with roles", () => {
		const host = makeHost((_method, url) => {
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
		});

		return runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "outgoing",
						synchronization: "authoritative",
						relationshipSchemaSlug: "person-to-movie",
						entities: [
							{
								name: "Film",
								externalId: "2",
								providerSlug: "movie.tmdb",
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
								providerSlug: "show.tmdb",
								relationshipProperties: { roles: ["Director"] },
							},
						],
					},
				]);
				return undefined;
			}),
			Effect.runPromise,
		);
	});
});
