import { Link, createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef } from "react";

import { UserSettingsApi } from "#/api/user-settings";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { AppIcon } from "#/modules/navigation/app-icon";
import { AccountProfile } from "#/modules/settings/account-profile";
import { AccountServer } from "#/modules/settings/account-server";
import { AccountSession } from "#/modules/settings/account-session";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountRoute,
});

function AccountRoute() {
	const { runtime, scope, server } = Route.useRouteContext();
	const auth = runtime.runSync(AuthService);
	const { isNative } = runtime.runSync(RuntimeOAuthClientService);
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);

	const generateAvatar = () =>
		runtime.runPromise(
			Effect.flatMap(UserSettingsApi, (api) => api.refreshAvatar(scope)).pipe(
				Effect.flatMap(() => auth.settledSession(server, true)),
				Effect.as(undefined),
			),
			{ signal: controller.current.signal },
		);

	return (
		<SettingsFrame title="Account" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
				<AccountProfile session={auth.session(server)} onGenerateAvatar={generateAvatar} />
				<SettingsSection
					title="Server administration"
					detail="Manage server-wide data and operations."
				>
					<Link
						to="/god-mode"
						className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
					>
						<span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
							<AppIcon name="crown" size={20} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block font-semibold text-text">God Mode</span>
							<span className="block text-sm text-text-muted">
								Requires an admin access token. The token stays in memory on this device.
							</span>
						</span>
						<AppIcon name="chevron-right" className="shrink-0 text-text-subtle" />
					</Link>
				</SettingsSection>
				{isNative && <AccountServer server={server} />}
				<AccountSession runtime={runtime} server={server} />
			</div>
		</SettingsFrame>
	);
}
