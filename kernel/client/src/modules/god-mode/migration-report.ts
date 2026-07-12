import type {
	MigrationReportAnomalyCode,
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/god-mode/migration-report";
import { Match } from "effect";

export const migrationReportLevelPresentation = (level: MigrationReportLevel) =>
	Match.value(level).pipe(
		Match.when("info", () => ({ icon: "info", label: "Info", tone: "text-info" }) as const),
		Match.when(
			"warning",
			() => ({ label: "Warning", tone: "text-warning", icon: "circle-alert" }) as const,
		),
		Match.exhaustive,
	);

export const formatMigrationReportElapsed = (elapsedSeconds: number | null) =>
	elapsedSeconds === null ? "-" : `${elapsedSeconds.toLocaleString()}s`;

const codesWithoutDetail: ReadonlySet<MigrationReportAnomalyCode> = new Set([
	"asset-locator-unresolved",
	"asset-deletion-failed",
]);

export const migrationReportRecordsDetail = (code: MigrationReportAnomalyCode) =>
	!codesWithoutDetail.has(code);

const positionLabel = (detail: {
	kind: "show" | "podcast";
	requestedSeason: string | null;
	requestedEpisode: string | null;
}) => {
	const episode = detail.requestedEpisode ?? "unknown";
	return detail.kind === "podcast"
		? `episode ${episode}`
		: `season ${detail.requestedSeason ?? "unknown"}, episode ${episode}`;
};

export const migrationReportDetailLabel = (detail: MigrationReportDetail) =>
	Match.value(detail).pipe(
		Match.when(
			{ code: "integration-cache-provider-unmapped" },
			(value) => `Progress marker ${value.legacyCacheId}`,
		),
		Match.when(
			{ code: "integration-cache-entity-unresolved" },
			(value) => value.parentName ?? `Progress marker ${value.legacyCacheId}`,
		),
		Match.orElse((value) => `${value.parentName} — ${positionLabel(value)}`),
	);

export const migrationReportDetailSentence = (detail: MigrationReportDetail) =>
	Match.value(detail).pipe(
		Match.whenOr({ code: "seen-episode-absent" }, { code: "review-episode-absent" }, (value) => {
			const subject = value.code === "seen-episode-absent" ? "this watch" : "this review";
			if (value.kind === "podcast") {
				return `The podcast's stored episode list has no episode ${value.requestedEpisode ?? "with that number"} — it has ${value.availableSummary} — so there was no episode to attach ${subject} to.`;
			}
			return value.seasonExists
				? `Season ${value.requestedSeason} is in the show's stored season list but has no episode ${value.requestedEpisode}, so there was no episode to attach ${subject} to.`
				: `The show's stored season list has no season ${value.requestedSeason} — it has ${value.availableSummary} — so there was no episode to attach ${subject} to.`;
		}),
		Match.whenOr(
			{ code: "seen-episode-ambiguous" },
			{ code: "review-episode-ambiguous" },
			(value) =>
				`${value.candidateCount} stored episodes claim that position, so there was no way to tell which one was meant.`,
		),
		Match.when(
			{ code: "seen-episode-malformed" },
			(value) =>
				`The legacy row stored ${value.kind === "podcast" ? `episode ${JSON.stringify(value.requestedEpisode)}` : `season ${JSON.stringify(value.requestedSeason)} and episode ${JSON.stringify(value.requestedEpisode)}`}, which is not a usable episode number.`,
		),
		Match.when({ code: "integration-cache-provider-unmapped" }, (value) =>
			value.providersConsumedOn.length === 1
				? `The service "${value.legacyProvider}" that produced this marker has no equivalent in V2, so its claim could not be recreated.`
				: `This marker names ${value.providersConsumedOn.length} services, and a V2 claim needs exactly one.`,
		),
		Match.when(
			{ code: "integration-cache-entity-unresolved" },
			() => "The item this marker points at was not migrated, so nothing in V2 can hold it.",
		),
		Match.exhaustive,
	);

export const migrationReportDetailProvenance = (detail: MigrationReportDetail) =>
	Match.value(detail)
		.pipe(
			Match.when({ code: "integration-cache-provider-unmapped" }, (value) => [
				["Cache row", value.legacyCacheId],
				["User", value.userId],
				["Services", value.providersConsumedOn.join(", ")],
			]),
			Match.when({ code: "integration-cache-entity-unresolved" }, (value) => [
				["Cache row", value.legacyCacheId],
				["User", value.userId],
				["Legacy item", value.legacyMetadataId],
			]),
			Match.orElse((value) => [
				["Title", value.parentName],
				["Entity", value.parentEntityId],
				["Legacy row", value.legacyRecordId],
				["User", value.userId],
			]),
		)
		.filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== "")
		.map(([key, value]) => ({ key, value }));

export const buildMigrationReportClipboardText = (input: {
	readonly phase: string;
	readonly message: string;
	readonly totalDetails: number | null;
	readonly code: MigrationReportAnomalyCode;
	readonly details: readonly MigrationReportDetail[];
}) => {
	const lines = [
		`Ryot migration report — ${input.phase}`,
		`Code: ${input.code}`,
		input.message,
		"",
	];
	for (const detail of input.details) {
		lines.push(`- ${migrationReportDetailLabel(detail)}: ${migrationReportDetailSentence(detail)}`);
		for (const entry of migrationReportDetailProvenance(detail)) {
			lines.push(`    ${entry.key}: ${entry.value}`);
		}
	}
	const remaining = (input.totalDetails ?? input.details.length) - input.details.length;
	if (remaining > 0) {
		lines.push("", `...and ${remaining} more not listed here.`);
	}
	return lines.join("\n");
};
