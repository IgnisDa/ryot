import { RyotClientError } from "@ryot-app/client-sdk";
import {
	createRyotMutation,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/client-sdk/react";
import type { TwoFactorStatus } from "@ryot-app/contract/modules/user-settings/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { UserSettingsApi } from "#/api/user-settings";
import type { KernelHostServices } from "#/host-services";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { AccountProfile } from "#/modules/settings/account-profile";
import { AccountSession } from "#/modules/settings/account-session";
import { AccountTwoFactor } from "#/modules/settings/account-two-factor";
import { SettingsFrame } from "#/modules/settings/settings-frame";

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
				<AccountSession
					isPending={signOut.isPending}
					failed={signOut.status === "error"}
					onSignOut={() => signOut.mutateEffect()}
				/>
			</div>
		</SettingsFrame>
	);
}
