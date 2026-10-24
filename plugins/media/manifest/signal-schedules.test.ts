import { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { Predicate } from "@ryot-app/contract/modules/ryotql/language";
import { table } from "@ryot-app/ryotql";
import { objectContaining } from "@ryot-app/testing/matchers";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { libraryLinkExists } from "../shared/entity-selections";
import { mediaPlugin } from "./plugin";

const { signalSchedules = [] } = Schema.decodeSync(AuthoredPluginManifest)(mediaPlugin);

const schedule = (slug: string) => {
	const found = signalSchedules.find((candidate) => candidate.slug === slug);
	if (!found) {
		throw new Error(`Missing signal schedule ${slug}`);
	}
	return found;
};

const predicates = (slug: string): readonly Predicate[] => {
	const { where } = schedule(slug).query;
	return where?.type === "and" ? where.predicates : [];
};

const expectMonitoringLink = (slug: string, predicate: Predicate | undefined) => {
	const alias = predicate?.type === "exists" ? predicate.query.from.alias : "";
	expect(alias).not.toBe("");
	expect(predicate).toEqual(
		libraryLinkExists(
			table("entity", schedule(slug).subject.entityAlias),
			alias,
			"media-monitoring",
		),
	);
};

describe("media signal schedules", () => {
	it("declares release, stale-progress and episode-availability schedules", () => {
		expect(
			signalSchedules.map(({ slug, signal, precision, delayDays, freshness, requiresProKey }) => [
				slug,
				signal,
				precision,
				delayDays ?? null,
				requiresProKey ?? false,
				freshness?.maxAgeHours ?? null,
			]),
		).toEqual([
			["show-episode-releases", "media.released", "date", null, false, 72],
			["podcast-episode-releases", "media.released", "date", null, false, 72],
			["anime-airing-releases", "media.released", "instant", null, false, 72],
			["flat-releases", "media.released", "date", null, false, 72],
			["in-progress-stale", "media.progress-stale", "instant", 7, true, null],
			["on-hold-stale", "media.progress-stale", "instant", 14, true, null],
			["show-episodes-available", "media.episodes-available", "date", null, false, null],
			["podcast-episodes-available", "media.episodes-available", "date", null, false, null],
		]);
		expect(schedule("show-episode-releases").properties).toEqual({
			entityName: "entityName",
			seasonNumber: "seasonNumber",
			episodeNumber: "episodeNumber",
		});
		expect(schedule("flat-releases").properties).toEqual({ entityName: "entityName" });
	});

	it.each([
		"show-episode-releases",
		"podcast-episode-releases",
		"anime-airing-releases",
		"flat-releases",
	])("limits %s to monitored media", (slug) => {
		expectMonitoringLink(
			slug,
			predicates(slug).find(
				(predicate) =>
					predicate.type === "exists" && predicate.query.from.alias.endsWith("Monitoring"),
			),
		);
	});

	it.each(["show-episodes-available", "podcast-episodes-available"])(
		"limits %s to caught-up series without monitoring",
		(slug) => {
			const negated = predicates(slug).find((predicate) => predicate.type === "not");
			expectMonitoringLink(slug, negated?.type === "not" ? negated.predicate : undefined);
			expect(JSON.stringify(predicates(slug))).toContain('"caught_up"');
		},
	);

	it("skips season-zero specials when announcing show episodes", () => {
		const nested = predicates("show-episode-releases").flatMap((predicate) =>
			predicate.type === "and" ? predicate.predicates : [predicate],
		);
		expect(nested).toContainEqual(
			objectContaining({
				operator: "gt",
				type: "comparison",
				right: { value: 0, type: "literal" },
			}),
		);
	});

	it.each([
		["in-progress-stale", "in_progress"],
		["on-hold-stale", "on_hold"],
	])("keys %s nudges by their unchanged lifecycle state and activity", (slug, state) => {
		expect(JSON.stringify(predicates(slug))).toContain(`"${state}"`);
		expect(schedule(slug).properties).toEqual({
			days: "days",
			entityName: "entityName",
			lifecycleState: "lifecycleState",
		});
	});
});
