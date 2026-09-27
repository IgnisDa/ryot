import { RyotClientError } from "@ryot-app/client-sdk";
import {
	createRyotMutation,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/client-sdk/react";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { TwoFactorStatus } from "@ryot-app/contract/modules/user-settings/schemas";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { PublicApi } from "#/api/public";
import { UserSettingsApi } from "#/api/user-settings";
import type { KernelHostServices } from "#/host-services";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { AccountProfile } from "#/modules/settings/account-profile";
import { AccountServer } from "#/modules/settings/account-server";
import { AccountSession } from "#/modules/settings/account-session";
import { AccountTwoFactor } from "#/modules/settings/account-two-factor";
import { AccountVersions } from "#/modules/settings/account-versions";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountRoute,
});

const accountIdentityQuery = createRyotQuery<void, SettledAuthSession, KernelHostServices>(
	({ hostServices }) =>
		hostServices.runtime
			.runSync(AuthService)
			.settledSession(hostServices.scope.serverUrl)
			.pipe(Effect.mapError(() => new RyotClientError("transport"))),
);

const serverVersionQuery = createRyotQuery<void, string, KernelHostServices>(({ hostServices }) =>
	hostServices.runtime
		.runSync(PublicApi)
		.getSystemConfig(hostServices.scope.serverUrl)
		.pipe(
			Effect.map((config) => config.version),
			Effect.mapError(() => new RyotClientError("transport")),
		),
);

const twoFactorStatusQuery = createRyotQuery<void, TwoFactorStatus, KernelHostServices>(
	({ hostServices }) =>
		hostServices.runtime
			.runSync(UserSettingsApi)
			.twoFactorStatus(hostServices.scope)
			.pipe(Effect.mapError(() => new RyotClientError("transport"))),
	{ cancelOnUnmount: true },
);

const refreshAvatarMutation = createRyotMutation<void, void, KernelHostServices>(
	({ client, hostServices }) =>
		hostServices.runtime
			.runSync(UserSettingsApi)
			.refreshAvatar(hostServices.scope)
			.pipe(
				Effect.flatMap(() =>
					hostServices.runtime
						.runSync(AuthService)
						.settledSession(hostServices.scope.serverUrl, true),
				),
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
				Effect.as(undefined),
				Effect.mapError(() => new RyotClientError("transport")),
			),
);

const signOutMutation = createRyotMutation<void, boolean, KernelHostServices>(({ hostServices }) =>
	hostServices.runtime
		.runSync(AuthService)
		.signOut(hostServices.scope.serverUrl)
		.pipe(Effect.mapError(() => new RyotClientError("transport"))),
);

function AccountRoute() {
	const { server, runtime } = Route.useRouteContext();
	const { isNative } = runtime.runSync(RuntimeOAuthClientService);
	const identity = useRyotQuery(accountIdentityQuery);
	const twoFactorStatus = useRyotQuery(twoFactorStatusQuery);
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const serverVersion = useRyotQuery(serverVersionQuery);
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
				<AccountTwoFactor
					isDemo={isDemo}
					status={twoFactorStatus.data}
					isLoading={twoFactorStatus.isPending}
					onRetry={() => twoFactorStatus.refetch()}
					onOpenNative={
						isNative
							? () =>
									runtime.runFork(
										runtime
											.runSync(HostedAuthService)
											.openTwoFactorManagement(server)
											.pipe(
												Effect.ignore,
												Effect.andThen(Effect.sync(() => twoFactorStatus.refetch())),
											),
									)
							: undefined
					}
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
							<AppIcon size={20} name="crown" />
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
				<AccountVersions
					serverVersion={serverVersion.data}
					isLoading={serverVersion.isPending}
					onRetry={() => serverVersion.refetch()}
				/>
				<AccountSession
					isPending={signOut.isPending}
					failed={signOut.status === "error"}
					onSignOut={() => signOut.mutateEffect()}
				/>
			</div>
		</SettingsFrame>
	);
}
