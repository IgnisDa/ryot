import type {
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/instance-admin/migration-report";
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

export const formatMigrationReportElapsed = (elapsedSeconds: null | number) =>
	elapsedSeconds === null ? "-" : `${elapsedSeconds.toLocaleString()}s`;

export const migrationReportDetailProvenance = (detail: MigrationReportDetail) =>
	detail.provenance.flatMap(({ key, value }) =>
		value === null || value === "" ? [] : [{ key, value }],
	);

export const buildMigrationReportClipboardText = (input: {
	readonly code: string;
	readonly phase: string;
	readonly message: string;
	readonly totalDetails: null | number;
	readonly details: readonly MigrationReportDetail[];
}) => {
	const lines = [
		`Ryot migration report — ${input.phase}`,
		`Code: ${input.code}`,
		input.message,
		"",
	];
	for (const detail of input.details) {
		lines.push(`- ${detail.label}: ${detail.sentence}`);
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
