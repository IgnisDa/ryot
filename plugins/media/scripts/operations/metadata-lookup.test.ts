import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { describe, expect, it } from "vitest";

import { execution, httpSuccess, integrationRecord } from "../automations/automation-test-utils";
import definition, { manifest } from "./metadata-lookup.sandbox";

const tmdbResults = (pathname: string, query: string): JsonValue[] => {
	if (pathname.endsWith("/search/tv")) {
		return query === "Breaking Bad"
			? [{ id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20" }]
			: [];
	}
	return query === "The Matrix"
		? [{ id: 603, title: "The Matrix", release_date: "1999-03-31" }]
		: [];
};

const createHost = (integration = integrationRecord({ provider: "ryot_browser_extension" })) => {
	const queries: string[] = [];
	return {
		queries,
		host: defineSandboxTestHost(manifest, {
			getCurrentIntegration: () => Effect.succeed(integration),
			getPluginConfig: (keys) =>
				Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
			getUserPreferences: () => Effect.succeed({ isNsfw: false, disableIntegrations: false }),
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				const query = requestUrl.searchParams.get("query") ?? "";
				queries.push(`${requestUrl.pathname}?${query}`);
				return httpSuccess({ results: tmdbResults(requestUrl.pathname, query) });
			},
		}),
	};
};

const runLookup = (titles: string[], integration?: ReturnType<typeof integrationRecord>) => {
	const { host, queries } = createHost(integration);
	return {
		queries,
		result: runSandboxTestScript(
			definition,
			{ titles, integrationId: "integration-1" },
			host,
			execution,
		),
	};
};

describe("metadata lookup operation", () => {
	it("aligns batched results with the requested titles and attaches show coordinates", async () => {
		const { queries, result } = runLookup([
			"Breaking Bad S02E03",
			"The Matrix (1999)",
			"Totally Unknown Thing",
		]);

		await expect(Effect.runPromise(result)).resolves.toEqual({
			results: [
				{
					status: "found",
					title: "Breaking Bad",
					showInformation: { season: 2, episode: 3 },
					data: { source: "tmdb", lot: "show", identifier: "1396" },
				},
				{
					status: "found",
					title: "The Matrix",
					data: { source: "tmdb", lot: "movie", identifier: "603" },
				},
				{ notFound: true, status: "notFound" },
			],
		});
		expect([...queries].sort()).toEqual([
			"/3/search/movie?Breaking Bad",
			"/3/search/movie?The Matrix",
			"/3/search/movie?Totally Unknown Thing",
			"/3/search/tv?Breaking Bad",
			"/3/search/tv?The Matrix",
			"/3/search/tv?Totally Unknown Thing",
		]);
	});

	it("rejects integrations that are not browser extensions before searching", async () => {
		const { queries, result } = runLookup(["Breaking Bad S02E03"], integrationRecord());

		await expect(Effect.runPromise(Effect.flip(result))).resolves.toEqual(
			new Error("Integration is not a browser extension integration"),
		);
		expect(queries).toEqual([]);
	});

	it("rejects a batch containing a blank title", async () => {
		const { queries, result } = runLookup(["Breaking Bad S02E03", "   "]);

		await expect(Effect.runPromise(Effect.flip(result))).resolves.toEqual(
			new Error("title is required"),
		);
		expect(queries).toEqual([]);
	});
});
