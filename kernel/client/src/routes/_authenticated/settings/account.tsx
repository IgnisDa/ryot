import type { TwoFactorStatus } from "@ryot-app/contract/modules/account/schemas";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import {
	createRyotHostMutation,
	createRyotHostQuery,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { twoFactorStatusRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { AccountApi } from "#/api/account";
import type { AuthenticatedApiError } from "#/api/authenticated";
import { KernelHostServices } from "#/host-services";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService, type SettledAuthSession } from "#/modules/auth/service";
import type { OAuthTokenError } from "#/modules/auth/token-service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { AccountProfile } from "#/modules/settings/account-profile";
import { AccountSession } from "#/modules/settings/account-session";
import { AccountTwoFactor } from "#/modules/settings/account-two-factor";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountRoute,
});

const accountIdentityQuery = createRyotHostQuery<void, SettledAuthSession, KernelHostServices>(
	({ hostServices }) =>
		hostServices.runtime
			.runSync(AuthService)
			.settledSession(hostServices.scope.serverUrl)
			.pipe(Effect.mapError(() => new RyotClientError({ reason: "transport" }))),
	{ hostServices: KernelHostServices },
);

const twoFactorStatusQuery = createRyotQuery<void, TwoFactorStatus>(
	({ client }) => client.data.query(twoFactorStatusRecipe, {}),
	{ cancelOnUnmount: true },
);

const refreshAvatarMutation = createRyotHostMutation<
	void,
	void,
	KernelHostServices,
	OAuthTokenError | AuthenticatedApiError
>(
	({ client, hostServices }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.refreshAvatar(hostServices.scope)
			.pipe(
				Effect.flatMap(() =>
					hostServices.runtime
						.runSync(AuthService)
						.settledSession(hostServices.scope.serverUrl, true),
				),
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
				Effect.as(undefined),
			),
	{ hostServices: KernelHostServices },
);

const renameMutation = createRyotHostMutation<
	string,
	void,
	KernelHostServices,
	OAuthTokenError | AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.rename(hostServices.scope, { payload: { name: input } })
			.pipe(
				Effect.flatMap(() =>
					hostServices.runtime
						.runSync(AuthService)
						.settledSession(hostServices.scope.serverUrl, true),
				),
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
				Effect.as(undefined),
			),
	{ hostServices: KernelHostServices },
);

const signOutMutation = createRyotHostMutation<void, boolean, KernelHostServices, OAuthTokenError>(
	({ hostServices }) =>
		hostServices.runtime.runSync(AuthService).signOut(hostServices.scope.serverUrl),
	{ hostServices: KernelHostServices },
);

function AccountRoute() {
	const t = useT();
	const { server, runtime } = Route.useRouteContext();
	const { isNative } = runtime.runSync(RuntimeOAuthClientService);
	const identity = useRyotQuery(accountIdentityQuery);
	const twoFactorStatus = useRyotQuery(twoFactorStatusQuery);
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const refreshAvatar = useRyotMutation(refreshAvatarMutation);
	const rename = useRyotMutation(renameMutation);
	const signOut = useRyotMutation(signOutMutation);

	return (
		<SettingsFrame
			backFallbackHref="/settings"
			title={t(kernelMessage("client.settings.section.account"))}
		>
			<div className="flex flex-col gap-8">
				<AccountProfile
					isDemo={isDemo}
					identity={identity.data}
					isLoading={identity.isPending}
					onRetry={() => identity.refetch()}
					generationError={refreshAvatar.error}
					isGenerating={refreshAvatar.isPending}
					onRename={(name) => rename.mutateEffect(name)}
					onGenerateAvatar={() => refreshAvatar.mutate()}
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
					error={signOut.error}
					isPending={signOut.isPending}
					onSignOut={() => signOut.mutateEffect()}
				/>
			</div>
		</SettingsFrame>
	);
}
