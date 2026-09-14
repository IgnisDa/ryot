import { createFileRoute } from "@tanstack/react-router";

import { useGodMode } from "#/modules/god-mode/context";
import { MigrationReportView } from "#/modules/god-mode/migration-report-view";
import { GodModeService } from "#/modules/god-mode/service";

export const Route = createFileRoute("/god-mode/migration-report")({
	component: GodModeMigrationReport,
});

function GodModeMigrationReport() {
	const { runtime } = Route.useRouteContext();
	const { sessionId, unauthorized } = useGodMode();
	const service = runtime.runSync(GodModeService);
	return (
		<MigrationReportView
			unauthorized={unauthorized}
			load={(signal) => runtime.runPromiseExit(service.getMigrationReport(sessionId), { signal })}
		/>
	);
}
