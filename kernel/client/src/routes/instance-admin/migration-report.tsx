import { createFileRoute } from "@tanstack/react-router";

import { useInstanceAdmin } from "#/modules/instance-admin/context";
import { MigrationReportView } from "#/modules/instance-admin/migration-report-view";
import { InstanceAdminService } from "#/modules/instance-admin/service";

export const Route = createFileRoute("/instance-admin/migration-report")({
	component: InstanceAdminMigrationReport,
});

function InstanceAdminMigrationReport() {
	const { runtime } = Route.useRouteContext();
	const { sessionId, unauthorized } = useInstanceAdmin();
	const service = runtime.runSync(InstanceAdminService);
	return (
		<MigrationReportView
			unauthorized={unauthorized}
			load={(after) => service.getMigrationReport(sessionId, after)}
		/>
	);
}
