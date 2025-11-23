import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../../test-utils";
import metronComicBookScriptCode from "./metron.sandbox.js" with { type: "text" };

const runMetronDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(metronComicBookScriptCode, context, hostFunctions);

describe("comic-book.metron sandbox script", () => {
	it("keeps arc issues as related entities", () => {
		return runMetronDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: (...args: Array<unknown>) =>
					hostSuccess(args[0] === "providers.metronUsername" ? "user" : "pass"),
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = String(args[1]);
					if (requestUrl.includes("/issue/1/")) {
						return httpSuccess({
							id: 1,
							number: "1",
							credits: [],
							arcs: [{ id: 55 }],
							cover_date: "2024-01-01",
							series: { id: 10, name: "Saga" },
						});
					}
					return httpSuccess({
						results: [
							{ id: 1, number: "1", series: { name: "Saga" } },
							{ id: 2, number: "2", series: { name: "Saga" } },
						],
					});
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntityGroups).toEqual([
				{ direction: "incoming", entities: [], relationshipSchemaSlug: "person-to-comic-book" },
				{
					direction: "incoming",
					relationshipSchemaSlug: "comic-book-group-to-comic-book",
					entities: [
						{
							name: "Saga",
							externalId: "10",
							scriptSlug: "comic-book-group.metron",
							relationshipProperties: { roles: ["Member"] },
						},
					],
				},
				{
					direction: "outgoing",
					relationshipSchemaSlug: "media-suggestion",
					entities: [{ name: "Saga #2", externalId: "2", scriptSlug: "comic-book.metron" }],
				},
			]);
			return undefined;
		});
	});
});
