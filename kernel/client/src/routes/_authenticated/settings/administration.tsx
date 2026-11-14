import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createRyotHostQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Effect } from "effect";

import { PublicApi } from "#/api/public";
import { KernelHostServices } from "#/host-services";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AboutServer } from "#/modules/settings/about-server";
import { AboutVersions } from "#/modules/settings/about-versions";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/administration")({
	component: AdministrationRoute,
});

const serverVersionQuery = createRyotHostQuery<void, string, KernelHostServices>(
	({ hostServices }) =>
		hostServices.runtime
			.runSync(PublicApi)
			.getSystemConfig(hostServices.scope.serverUrl)
			.pipe(
				Effect.mapBoth({
					onSuccess: (config) => config.version,
					onFailure: () => new RyotClientError({ reason: "transport" }),
				}),
			),
	{ hostServices: KernelHostServices },
);

function AdministrationRoute() {
	const { server, runtime } = Route.useRouteContext();
	const { isNative } = runtime.runSync(RuntimeOAuthClientService);
	const serverVersion = useRyotQuery(serverVersionQuery);

	return (
		<SettingsFrame title="Administration" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
				<SettingsSection
					title="Server administration"
					detail="Manage server-wide data and operations."
				>
					<Link
						to="/instance-admin"
						className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
					>
						<span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
							<AppIcon size={20} name="crown" />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block font-semibold text-text">Instance Admin</span>
							<span className="block text-sm text-text-muted">
								Requires an admin access token. The token stays in memory on this device.
							</span>
						</span>
						<AppIcon name="chevron-right" className="shrink-0 text-text-subtle" />
					</Link>
				</SettingsSection>
				<AboutVersions
					serverVersion={serverVersion.data}
					isLoading={serverVersion.isPending}
					onRetry={() => serverVersion.refetch()}
				/>
				{isNative && <AboutServer server={server} />}
			</div>
		</SettingsFrame>
	);
}
