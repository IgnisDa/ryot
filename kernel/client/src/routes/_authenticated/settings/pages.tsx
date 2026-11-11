import { createFileRoute } from "@tanstack/react-router";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { PagesManager } from "#/modules/page-authoring/manager";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/pages")({ component: PagesRoute });

function PagesRoute() {
	const { server, runtime } = Route.useRouteContext();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<SettingsFrame title="Pages" backFallbackHref="/settings">
			<PagesManager disabled={disabled} />
		</SettingsFrame>
	);
}
