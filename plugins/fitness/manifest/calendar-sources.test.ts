import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { fitnessPlugin } from "./plugin";

describe("fitness calendar sources", () => {
	it("declares the workouts source with the contract shape", () => {
		const { calendarSources = [] } = Schema.decodeSync(AuthoredPluginManifest)(fitnessPlugin);
		expect(
			calendarSources.map(({ art, slug, done, subject, startAt, caption, precision }) => ({
				art,
				done,
				slug,
				startAt,
				caption,
				precision,
				subject: subject.entityAlias,
			})),
		).toEqual([
			{
				art: undefined,
				done: undefined,
				slug: "workouts",
				subject: "workout",
				startAt: "startAt",
				caption: "caption",
				precision: "instant",
			},
		]);
		const [source] = calendarSources;
		expect(source?.query.from.alias).toBe(source?.subject.entityAlias);
		const output = source?.query.output;
		expect(
			output?.type === "rows" ? output.fields.flatMap((f) => ("key" in f ? [f.key] : [])) : [],
		).toEqual(["startAt", "caption"]);
	});
});
