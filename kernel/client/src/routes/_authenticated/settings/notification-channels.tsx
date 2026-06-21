import { createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/notification-channels")({
	component: NotificationChannelsRoute,
});

function NotificationChannelsRoute() {
	return (
		<SettingsFrame title="Notification channels" backFallbackHref="/settings">
			<p className="text-sm leading-6 text-text-muted">
				TODO: Configure account-wide outbound notification channels.
			</p>
		</SettingsFrame>
	);
}
