import { describe, expect, it } from "vitest";

import titleCaseHelperCode from "../../../script-helpers/title-case.sandbox.js" with { type: "text" };
import {
	type HostFunction,
	httpSuccess,
	runProviderDriver,
	toRecord,
	withTitleCaseHelper,
} from "../../test-utils";
import audibleAudiobookScriptCode from "./audible.sandbox.js" with { type: "text" };

const audibleCode = withTitleCaseHelper(titleCaseHelperCode, audibleAudiobookScriptCode);

const runAudibleDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(audibleCode, context, hostFunctions);

describe("audiobook.audible sandbox script", () => {
	it("deduplicates similarity buckets into related entities", () => {
		return runAudibleDetails(
			{ externalId: "source-book" },
			{
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = String(args[1]);
					if (requestUrl.includes("/source-book?")) {
						return httpSuccess({
							product: {
								series: [],
								authors: [],
								narrators: [],
								title: "Source",
								product_images: {},
								category_ladders: [],
								is_adult_product: false,
								runtime_length_min: 100,
								release_date: "2024-01-01",
								rating: { num_reviews: 0, overall_distribution: {} },
							},
						});
					}
					if (requestUrl.includes("similarity_type=InTheSameSeries")) {
						return httpSuccess({
							similar_products: [{ asin: "book-2", title: "Series Pick" }],
						});
					}
					if (requestUrl.includes("similarity_type=RawSimilarities")) {
						return httpSuccess({
							similar_products: [
								{ asin: "book-2", title: "Series Pick" },
								{ asin: "book-3", title: "Similar Pick" },
							],
						});
					}
					return httpSuccess({ similar_products: [] });
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details["relatedEntityGroups"]).toEqual([
				{
					direction: "incoming",
					synchronization: "authoritative",
					entities: [],
					relationshipSchemaSlug: "person-to-audiobook",
				},
				{
					entities: [],
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "audiobook-group-to-audiobook",
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Series Pick", externalId: "book-2", scriptSlug: "audiobook.audible" },
						{ name: "Similar Pick", externalId: "book-3", scriptSlug: "audiobook.audible" },
					],
				},
			]);
			return undefined;
		});
	});
});
