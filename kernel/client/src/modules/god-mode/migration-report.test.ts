import type { MigrationReportDetail } from "@ryot-app/contract/modules/god-mode/migration-report";
import { describe, expect, it } from "vitest";

import {
	buildMigrationReportClipboardText,
	formatMigrationReportElapsed,
	migrationReportDetailLabel,
	migrationReportDetailProvenance,
	migrationReportDetailSentence,
	migrationReportLevelPresentation,
	migrationReportRecordsDetail,
} from "#/modules/god-mode/migration-report";

const blackMirror = {
	kind: "show",
	seasonExists: false,
	requestedSeason: "0",
	requestedEpisode: "1",
	parentName: "Black Mirror",
	userId: "usr_ujrD0pCeKc1Y",
	code: "seen-episode-absent",
	parentEntityId: "met_WYGquxnbOnHd",
	legacyRecordId: "see_hlFQdGwVxnPL",
	availableSummary: "seasons 1, 2, 3, 4, 5, 6, 7",
} as const satisfies MigrationReportDetail;

describe("migration report presentation", () => {
	it("presents warning and information levels", () => {
		expect(migrationReportLevelPresentation("warning")).toEqual({
			label: "Warning",
			tone: "text-warning",
			icon: "circle-alert",
		});
		expect(migrationReportLevelPresentation("info")).toEqual({
			icon: "info",
			label: "Info",
			tone: "text-info",
		});
	});

	it("formats optional elapsed seconds", () => {
		expect(formatMigrationReportElapsed(null)).toBe("-");
		expect(formatMigrationReportElapsed(12.5)).toBe("12.5s");
	});

	it("explains an absent season by naming what the stored metadata has", () => {
		expect(migrationReportDetailLabel(blackMirror)).toBe("Black Mirror — season 0, episode 1");
		expect(migrationReportDetailSentence(blackMirror)).toBe(
			"The show's stored season list has no season 0 — it has seasons 1, 2, 3, 4, 5, 6, 7 — so there was no episode to attach this watch to.",
		);
	});

	it("distinguishes a present season missing one episode from an absent season", () => {
		expect(
			migrationReportDetailSentence({
				...blackMirror,
				seasonExists: true,
				requestedSeason: "4",
				requestedEpisode: "99",
			}),
		).toBe(
			"Season 4 is in the show's stored season list but has no episode 99, so there was no episode to attach this watch to.",
		);
	});

	it("drops season wording for podcasts and reviews", () => {
		expect(
			migrationReportDetailSentence({
				...blackMirror,
				kind: "podcast",
				requestedSeason: null,
				requestedEpisode: "512",
				code: "review-episode-absent",
				availableSummary: "episodes 1-430",
			}),
		).toBe(
			"The podcast's stored episode list has no episode 512 — it has episodes 1-430 — so there was no episode to attach this review to.",
		);
	});

	it("explains ambiguity and malformed positions", () => {
		expect(
			migrationReportDetailSentence({
				kind: "show",
				candidateCount: 3,
				requestedSeason: "2",
				requestedEpisode: "5",
				parentName: "Black Mirror",
				userId: "usr_ujrD0pCeKc1Y",
				code: "seen-episode-ambiguous",
				parentEntityId: "met_WYGquxnbOnHd",
				legacyRecordId: "see_hlFQdGwVxnPL",
			}),
		).toBe(
			"3 stored episodes claim that position, so there was no way to tell which one was meant.",
		);
		expect(
			migrationReportDetailSentence({
				kind: "show",
				requestedSeason: null,
				requestedEpisode: "x",
				parentName: "Black Mirror",
				userId: "usr_ujrD0pCeKc1Y",
				code: "seen-episode-malformed",
				parentEntityId: "met_WYGquxnbOnHd",
				legacyRecordId: "see_hlFQdGwVxnPL",
			}),
		).toBe(
			'The legacy row stored season null and episode "x", which is not a usable episode number.',
		);
	});

	it("explains dropped integration cache markers", () => {
		expect(
			migrationReportDetailSentence({
				userId: "usr_1",
				legacyCacheId: "cache_1",
				legacyProvider: "Plexamp",
				providersConsumedOn: ["Plexamp"],
				code: "integration-cache-provider-unmapped",
			}),
		).toBe(
			'The service "Plexamp" that produced this marker has no equivalent in V2, so its claim could not be recreated.',
		);
		expect(
			migrationReportDetailSentence({
				userId: "usr_1",
				parentName: null,
				requestedSeason: null,
				requestedEpisode: null,
				legacyCacheId: "cache_2",
				legacyMetadataId: "met_gone",
				code: "integration-cache-entity-unresolved",
			}),
		).toBe("The item this marker points at was not migrated, so nothing in V2 can hold it.");
	});

	it("omits provenance entries that carry no value", () => {
		expect(migrationReportDetailProvenance(blackMirror)).toEqual([
			{ key: "Title", value: "Black Mirror" },
			{ key: "Entity", value: "met_WYGquxnbOnHd" },
			{ key: "Legacy row", value: "see_hlFQdGwVxnPL" },
			{ key: "User", value: "usr_ujrD0pCeKc1Y" },
		]);
		expect(
			migrationReportDetailProvenance({
				userId: "usr_1",
				parentName: null,
				requestedSeason: null,
				legacyMetadataId: null,
				requestedEpisode: null,
				legacyCacheId: "cache_2",
				code: "integration-cache-entity-unresolved",
			}),
		).toEqual([
			{ key: "Cache row", value: "cache_2" },
			{ key: "User", value: "usr_1" },
		]);
	});

	it("reports which checks record no per-record detail", () => {
		expect(migrationReportRecordsDetail("seen-episode-absent")).toBe(true);
		expect(migrationReportRecordsDetail("asset-locator-unresolved")).toBe(false);
		expect(migrationReportRecordsDetail("asset-deletion-failed")).toBe(false);
	});

	it("builds shareable text that notes details beyond the served page", () => {
		expect(
			buildMigrationReportClipboardText({
				totalDetails: 3,
				details: [blackMirror],
				phase: "seen -> event",
				code: "seen-episode-absent",
				message: "Some watch history was not carried over.",
			}),
		).toBe(
			[
				"Ryot migration report — seen -> event",
				"Code: seen-episode-absent",
				"Some watch history was not carried over.",
				"",
				"- Black Mirror — season 0, episode 1: The show's stored season list has no season 0 — it has seasons 1, 2, 3, 4, 5, 6, 7 — so there was no episode to attach this watch to.",
				"    Title: Black Mirror",
				"    Entity: met_WYGquxnbOnHd",
				"    Legacy row: see_hlFQdGwVxnPL",
				"    User: usr_ujrD0pCeKc1Y",
				"",
				"...and 2 more not listed here.",
			].join("\n"),
		);
	});
});
