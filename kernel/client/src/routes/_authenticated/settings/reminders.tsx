import { createFileRoute } from "@tanstack/react-router";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { ReminderManager } from "#/modules/reminders/manager";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/reminders")({
	component: RemindersRoute,
});

function RemindersRoute() {
	const { server, runtime } = Route.useRouteContext();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<SettingsFrame title="Reminders" backFallbackHref="/settings">
			<ReminderManager disabled={disabled} />
		</SettingsFrame>
	);
}
