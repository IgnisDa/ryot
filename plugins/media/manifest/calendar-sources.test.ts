import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { table } from "@ryot-app/ryotql";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { libraryLinkExists } from "../shared/entity-selections";
import { flatMediaSchemaSlugs } from "../shared/media-schema-slugs";
import { mediaPlugin } from "./plugin";

const { calendarSources = [] } = Schema.decodeSync(AuthoredPluginManifest)(mediaPlugin);

const source = (slug: string) => {
	const found = calendarSources.find((candidate) => candidate.slug === slug);
	if (!found) {
		throw new Error(`Missing calendar source ${slug}`);
	}
	return found;
};

describe("media calendar sources", () => {
	it("declares the four sources with the contract shape", () => {
		expect(
			calendarSources.map(({ slug, subject, precision }) => [
				slug,
				precision,
				subject.entityAlias,
				subject.schemas.map(({ slug: schemaSlug }) => schemaSlug),
			]),
		).toEqual([
			["show-episodes", "date", "show", ["show"]],
			["podcast-episodes", "date", "podcast", ["podcast"]],
			["anime-airings", "instant", "anime", ["anime"]],
			["releases", "date", "entity", [...flatMediaSchemaSlugs]],
		]);
		for (const { art, done, startAt, caption } of calendarSources) {
			expect({ art, done, startAt, caption }).toEqual({
				art: "art",
				done: "done",
				startAt: "startAt",
				caption: "caption",
			});
		}
	});

	it.each(["show-episodes", "podcast-episodes", "anime-airings", "releases"])(
		"limits %s to the subject's media library",
		(slug) => {
			const { query, subject } = source(slug);
			const predicates = query.where?.type === "and" ? query.where.predicates : [];
			const exists = predicates.find((predicate) => predicate.type === "exists");
			expect(exists).toEqual(
				libraryLinkExists(
					table("entity", subject.entityAlias),
					exists?.type === "exists" ? exists.query.from.alias : "",
					"in-media-library",
				),
			);
		},
	);
});
