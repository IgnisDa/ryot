import type { MigrationReportLevel } from "@ryot-app/contract/modules/god-mode/contract";
import { Match } from "effect";

export const migrationReportLevelPresentation = (level: MigrationReportLevel) =>
	Match.value(level).pipe(
		Match.when("info", () => ({ icon: "info", label: "Info", tone: "text-info" }) as const),
		Match.when(
			"warning",
			() => ({ label: "Warning", tone: "text-danger", icon: "circle-alert" }) as const,
		),
		Match.exhaustive,
	);

export const formatMigrationReportElapsed = (elapsedSeconds: number | null) =>
	elapsedSeconds === null ? "-" : `${elapsedSeconds.toLocaleString()}s`;
