import { MigrationReportTable } from "@/modules/god-mode/migration-report-table";
import { useGodModeSession } from "@/modules/god-mode/session";
import { SectionFrame } from "@/modules/ui/section-frame";

export function MigrationReportScreen() {
	const { lock } = useGodModeSession();

	return (
		<SectionFrame
			title="Migration Report"
			contentClassName="w-full max-w-7xl self-center"
			overflowItems={[{ label: "Lock god mode", onPress: () => lock(null) }]}
		>
			<MigrationReportTable />
		</SectionFrame>
	);
}
