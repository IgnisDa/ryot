import {
	browseConsistencyIssue,
	browseIssue,
} from "@ryot-app/kernel-backend/modules/definitions/browse-validation";
import { revisionDefinitions } from "@ryot-app/kernel-backend/modules/definitions/source";
import { describe, expect, it } from "vitest";

import { mediaPlugin } from "./plugin";

const entitySchemas = revisionDefinitions("media-plugin", {
	...mediaPlugin,
	scripts: [],
}).entitySchemas;

const browse = (slug: string) => {
	const schema = entitySchemas.find((candidate) => candidate.slug === slug);
	if (!schema?.browse) {
		throw new Error(`Expected ${slug} to declare browse fields`);
	}
	return schema.browse.fields;
};

const keys = (slug: string) => browse(slug).map(({ key }) => key);

describe("media browse declarations", () => {
	it("passes install validation for every entity schema", () => {
		expect(browseConsistencyIssue(entitySchemas)).toBeUndefined();
		for (const schema of entitySchemas) {
			expect(schema.browse && browseIssue(schema.browse), schema.slug).toBeUndefined();
		}
	});

	it("declares library fields on titles and property fields only where defined", () => {
		expect(keys("movie")).toEqual([
			"status",
			"timesCompleted",
			"userRating",
			"lastCompletedAt",
			"lastActivityAt",
			"releaseDate",
			"addedAt",
			"source",
			"publishYear",
			"providerRating",
			"adultContent",
			"genres",
			"owned",
			"monitored",
		]);
		const status = (slug: string) => {
			const field = browse(slug).find(({ key }) => key === "status");
			return field && "choices" in field ? field.choices.map(({ value }) => value) : [];
		};
		expect(status("show")).toContain("caught_up");
		expect(status("movie")).not.toContain("caught_up");
		expect(browse("movie").find(({ key }) => key === "source")).toMatchObject({
			choices: [
				{ value: "custom", label: "Custom" },
				{ label: "TMDB", value: "movie.tmdb" },
				{ label: "TVDB", value: "movie.tvdb" },
			],
		});
	});

	it("declares creator and group fields", () => {
		expect(keys("person")).toEqual(["source", "userRating", "birthDate", "credits"]);
		expect(keys("company")).toEqual(["source", "userRating", "foundedYear", "credits"]);
		expect(keys("book-group")).toEqual(["source", "userRating", "parts"]);
		expect(entitySchemas.find(({ slug }) => slug === "show-episode")?.browse).toBeUndefined();
	});
});
