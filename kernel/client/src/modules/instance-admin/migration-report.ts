import type {
	MigrationReportDetail,
	MigrationReportLevel,
} from "@ryot-app/contract/modules/instance-admin/migration-report";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Match } from "effect";

export const migrationReportLevelPresentation = (level: MigrationReportLevel) =>
	Match.value(level).pipe(
		Match.when(
			"info",
			() =>
				({
					icon: "info",
					tone: "text-info",
					label: kernelMessage("client.instance-admin.migration-report.level.info"),
				}) as const,
		),
		Match.when(
			"warning",
			() =>
				({
					tone: "text-warning",
					icon: "circle-alert",
					label: kernelMessage("client.instance-admin.migration-report.level.warning"),
				}) as const,
		),
		Match.exhaustive,
	);

export const formatMigrationReportElapsed = (
	formatters: Formatters,
	elapsedSeconds: null | number,
) =>
	elapsedSeconds === null
		? "-"
		: formatters
				.number({ style: "unit", unit: "second", unitDisplay: "narrow" })
				.format(elapsedSeconds);

export const migrationReportDetailProvenance = (detail: MigrationReportDetail) =>
	detail.provenance.flatMap(({ key, value }) =>
		value === null || value === "" ? [] : [{ key, value }],
	);

export const buildMigrationReportClipboardText = (
	t: (message: Message) => Text,
	input: {
		readonly code: string;
		readonly phase: string;
		readonly message: string;
		readonly totalDetails: null | number;
		readonly details: readonly MigrationReportDetail[];
	},
) => {
	const lines = [
		t(
			kernelMessage("client.instance-admin.migration-report.clipboard.heading", {
				phase: input.phase,
			}),
		),
		t(kernelMessage("client.instance-admin.migration-report.clipboard.code", { code: input.code })),
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
		lines.push(
			"",
			t(
				kernelMessage("client.instance-admin.migration-report.clipboard.remaining", {
					count: remaining,
				}),
			),
		);
	}
	return lines.join("\n");
};
