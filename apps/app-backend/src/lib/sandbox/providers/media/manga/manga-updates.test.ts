import { describe, expect, it } from "vitest";

import { type HostFunction, httpSuccess, runProviderDriver, toRecord } from "../../test-utils";
import mangaUpdatesMangaScriptCode from "./manga-updates.sandbox.js" with { type: "text" };

const runMangaUpdatesDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(mangaUpdatesMangaScriptCode, context, hostFunctions);

describe("manga.manga-updates sandbox script", () => {
	it("keeps recommendation and related-series suggestions", () => {
		return runMangaUpdatesDetails(
			{ externalId: "1" },
			{
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = String(args[1]);
					if (requestUrl.endsWith("/series/1")) {
						return httpSuccess({
							genres: [],
							status: null,
							series_id: 1,
							title: "Source",
							recommendations: [{ series_id: 2 }],
							related_series: [{ related_series_id: 3 }],
						});
					}
					if (requestUrl.endsWith("/series/2")) {
						return httpSuccess({ title: "Recommendation", series_id: 2 });
					}
					return httpSuccess({ title: "Related", series_id: 3 });
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.suggestions).toEqual([
				{ name: "Recommendation", externalId: "2", scriptSlug: "manga.manga-updates" },
				{ name: "Related", externalId: "3", scriptSlug: "manga.manga-updates" },
			]);
			return undefined;
		});
	});
});
