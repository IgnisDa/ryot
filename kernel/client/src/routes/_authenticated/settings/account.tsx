import {
	createRyotMutation,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/client-sdk/react";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { UserSettingsApi } from "#/api/user-settings";
import type { KernelHostServices } from "#/host-services";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import { AccountProfile } from "#/modules/settings/account-profile";
import { AccountServer } from "#/modules/settings/account-server";
import { AccountSession } from "#/modules/settings/account-session";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountRoute,
});

const accountIdentityQuery = createRyotQuery<void, SettledAuthSession, KernelHostServices>(
	({ hostServices, signal }) =>
		hostServices.runtime.runPromise(
			Effect.flatMap(AuthService, (auth) => auth.settledSession(hostServices.scope.serverUrl)),
			{ signal },
		),
);

const refreshAvatarMutation = createRyotMutation<void, void, KernelHostServices>(
	({ client, hostServices, signal }) =>
		hostServices.runtime.runPromise(
			Effect.flatMap(UserSettingsApi, (api) => api.refreshAvatar(hostServices.scope)).pipe(
				Effect.flatMap(() =>
					Effect.flatMap(AuthService, (auth) =>
						auth.settledSession(hostServices.scope.serverUrl, true),
					),
				),
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
				Effect.as(undefined),
			),
			{ signal },
		),
);

const signOutMutation = createRyotMutation<void, boolean, KernelHostServices>(
	({ hostServices, signal }) =>
		hostServices.runtime.runPromise(
			Effect.flatMap(AuthService, (auth) => auth.signOut(hostServices.scope.serverUrl)),
			{ signal },
		),
);

function AccountRoute() {
	const { runtime, server } = Route.useRouteContext();
	const { isNative } = runtime.runSync(RuntimeOAuthClientService);
	const identity = useRyotQuery(accountIdentityQuery);
	const refreshAvatar = useRyotMutation(refreshAvatarMutation);
	const signOut = useRyotMutation(signOutMutation);

	return (
		<SettingsFrame title="Account" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
				<AccountProfile
					identity={identity.data}
					isLoading={identity.isPending}
					onRetry={() => identity.refetch()}
					isGenerating={refreshAvatar.isPending}
					onGenerateAvatar={() => refreshAvatar.mutate()}
					generationFailed={refreshAvatar.status === "error"}
				/>
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
				<AccountSession
					isPending={signOut.isPending}
					failed={signOut.status === "error"}
					onSignOut={() => signOut.mutateAsync()}
				/>
			</div>
		</SettingsFrame>
	);
}
