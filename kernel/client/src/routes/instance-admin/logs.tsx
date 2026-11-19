import { createFileRoute } from "@tanstack/react-router";

import { useInstanceAdmin } from "#/modules/instance-admin/context";
import { ServerLogsView } from "#/modules/instance-admin/logs-view";
import { InstanceAdminService } from "#/modules/instance-admin/service";

export const Route = createFileRoute("/instance-admin/logs")({ component: InstanceAdminLogs });

function InstanceAdminLogs() {
	const { runtime } = Route.useRouteContext();
	const { sessionId, unauthorized } = useInstanceAdmin();
	const service = runtime.runSync(InstanceAdminService);
	return (
		<ServerLogsView
			unauthorized={unauthorized}
			download={(file) => service.downloadLogs(sessionId, file)}
			load={(after, limit) => service.listLogs(sessionId, after, limit)}
		/>
	);
}
