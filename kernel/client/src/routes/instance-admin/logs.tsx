import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

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
			download={(file) => Effect.exit(service.downloadLogs(sessionId, file))}
			load={(after, limit) => Effect.exit(service.listLogs(sessionId, after, limit))}
		/>
	);
}
