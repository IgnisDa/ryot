import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { useGodMode } from "#/modules/god-mode/context";
import { ServerLogsView } from "#/modules/god-mode/logs-view";
import { GodModeService } from "#/modules/god-mode/service";

export const Route = createFileRoute("/god-mode/logs")({ component: GodModeLogs });

function GodModeLogs() {
	const { runtime } = Route.useRouteContext();
	const { sessionId, unauthorized } = useGodMode();
	const service = runtime.runSync(GodModeService);
	return (
		<ServerLogsView
			unauthorized={unauthorized}
			load={() => Effect.exit(service.listLogs(sessionId))}
			download={(file) => Effect.exit(service.downloadLogs(sessionId, file))}
		/>
	);
}
