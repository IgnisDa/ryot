import { describe, expect, it } from "bun:test";

import type { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { Predicate } from "@ryot-app/contract/modules/ryotql/authored";
import { revisionDefinitions } from "@ryot-app/definitions/source";
import { table } from "@ryot-app/ryotql";
import { objectContaining } from "@ryot-app/testing/matchers";

import { libraryLinkExists } from "../shared/entity-selections";
import { mediaPlugin } from "./plugin";

const { signalSchedules }: AuthoredPluginManifest = mediaPlugin;

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
			signalSchedules.map(({ slug, signal, precision, delayDays, freshness, entitlement }) => [
				slug,
				signal,
				precision,
				delayDays ?? null,
				entitlement ?? null,
				freshness?.maxAgeHours ?? null,
			]),
		).toEqual([
			["show-episode-releases", "media.released", "date", null, null, 72],
			["podcast-episode-releases", "media.released", "date", null, null, 72],
			["anime-airing-releases", "media.released", "instant", null, null, 72],
			["flat-releases", "media.released", "date", null, null, 72],
			["in-progress-stale", "media.progress-stale", "instant", 7, "pro", null],
			["on-hold-stale", "media.progress-stale", "instant", 14, "pro", null],
			["show-episodes-available", "media.episodes-available", "date", null, null, null],
			["podcast-episodes-available", "media.episodes-available", "date", null, null, null],
		]);
		expect(schedule("show-episode-releases").properties).toEqual({
			entityName: "entityName",
			seasonNumber: "seasonNumber",
			episodeNumber: "episodeNumber",
		});
		expect(schedule("flat-releases").properties).toEqual({ entityName: "entityName" });
	});

	it("bounds every schedule's global reads to the schemas it queries", () => {
		const materialized = revisionDefinitions("media-plugin", {
			...mediaPlugin,
			scripts: [],
		}).signalSchedules;
		expect(materialized.map(({ slug }) => slug)).toEqual(signalSchedules.map(({ slug }) => slug));
		for (const { slug, readSchemaSlugs } of materialized) {
			expect(readSchemaSlugs, slug).not.toBeNull();
		}
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
		expect(nested).toContainEqual<unknown>(
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
