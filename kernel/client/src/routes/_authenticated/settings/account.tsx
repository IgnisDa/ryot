import { createFileRoute } from "@tanstack/react-router";

import { AuthService } from "#/modules/auth/service";
import { AccountProfile } from "#/modules/settings/account-profile";
import { AccountSession } from "#/modules/settings/account-session";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountRoute,
});

function AccountRoute() {
	const { runtime, server } = Route.useRouteContext();
	const auth = runtime.runSync(AuthService);

	return (
		<SettingsFrame title="Account" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
				<AccountProfile server={server} session={auth.session(server)} />
				<AccountSession runtime={runtime} server={server} />
			</div>
		</SettingsFrame>
	);
}
