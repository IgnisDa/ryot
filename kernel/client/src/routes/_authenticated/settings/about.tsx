import { RyotClientError } from "@ryot-app/client-sdk";
import { createRyotQuery, useRyotQuery } from "@ryot-app/client-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { PublicApi } from "#/api/public";
import type { KernelHostServices } from "#/host-services";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AboutServer } from "#/modules/settings/about-server";
import { AboutVersions } from "#/modules/settings/about-versions";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/about")({ component: AboutRoute });

const serverVersionQuery = createRyotQuery<void, string, KernelHostServices>(({ hostServices }) =>
	hostServices.runtime
		.runSync(PublicApi)
		.getSystemConfig(hostServices.scope.serverUrl)
		.pipe(
			Effect.map((config) => config.version),
			Effect.mapError(() => new RyotClientError("transport")),
		),
);

function AboutRoute() {
	const { server, runtime } = Route.useRouteContext();
	const { isNative } = runtime.runSync(RuntimeOAuthClientService);
	const serverVersion = useRyotQuery(serverVersionQuery);

	return (
		<SettingsFrame title="About" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
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
