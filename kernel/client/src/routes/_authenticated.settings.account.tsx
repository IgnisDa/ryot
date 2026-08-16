import { createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountRoute,
});

function AccountRoute() {
	return <SettingsFrame title="Account" backFallbackHref="/settings" />;
}
