import { useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useCallback, useLayoutEffect, type ReactNode } from "react";

import { useScreenLeadingControl } from "#/modules/navigation/app-screen";
import {
	useEdge,
	usePluginHeader,
	usePluginTitle,
	useShellChrome,
} from "#/modules/navigation/authenticated-shell-context";
import { usePageTitle } from "#/modules/navigation/page-title";
import type { ActivePluginDestination } from "#/modules/plugins/active-plugin-destination";
import { ArtifactSessions, ArtifactSessionStaleError } from "#/modules/plugins/artifact-sessions";
import type { PluginScreenReadiness } from "#/modules/plugins/bridge";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginHost } from "#/modules/plugins/plugin-host";
import { PluginQueriesService } from "#/modules/plugins/queries";

export type PluginDestinationScreenState = PluginScreenReadiness & {
	readonly sourceHash: string;
	readonly installationId: string;
	readonly artifactHash: string | null;
};

export function PluginDestination(props: {
	readonly children: ReactNode;
	readonly target: ActivePluginDestination | null;
	readonly onScreenState: (state: PluginDestinationScreenState | null) => void;
}) {
	return props.target === null ? (
		props.children
	) : (
		<PluginInstallation target={props.target} onScreenState={props.onScreenState} />
	);
}

function PluginInstallation(props: {
	readonly target: ActivePluginDestination;
	readonly onScreenState: (state: PluginDestinationScreenState | null) => void;
}) {
	const edge = useEdge();
	const router = useRouter();
	const navigate = useNavigate();
	const chrome = useShellChrome();
	const header = usePluginHeader();
	const { refetch } = usePluginCatalog();
	const publishedTitle = usePluginTitle();
	const chromeLeading = useScreenLeadingControl();
	const { runtime, scope, theme } = useRouteContext({ from: "/_authenticated" });
	const { entry, installation } = props.target;
	const onScreenState = props.onScreenState;
	const { serverUrl, userId } = scope;
	usePageTitle(publishedTitle ?? installation.name);

	const onCreateArtifactSession = useCallback(
		(
			request: {
				readonly sourceHash: string;
				readonly artifactHash: string;
				readonly installationId: string;
			},
			signal: AbortSignal,
		) =>
			runtime.runPromise(
				Effect.flatMap(ArtifactSessions, (service) =>
					service
						.create({
							scope: { serverUrl, userId },
							pluginSlug: installation.slug,
							sourceHash: request.sourceHash,
							installationId: request.installationId,
							clientArtifactHash: request.artifactHash,
						})
						.pipe(
							Effect.tapError((error) =>
								error instanceof ArtifactSessionStaleError ? Effect.sync(refetch) : Effect.void,
							),
						),
				),
				{ signal },
			),
		[installation.slug, refetch, runtime, serverUrl, userId],
	);
	const onRenewArtifactSession = useCallback(
		(sessionId: string, signal: AbortSignal) =>
			runtime.runPromise(
				Effect.flatMap(ArtifactSessions, (service) =>
					service.renew({ scope: { serverUrl, userId }, sessionId }),
				),
				{ signal },
			),
		[runtime, serverUrl, userId],
	);
	const onRevokeArtifactSession = useCallback(
		(sessionId: string) =>
			runtime.runPromise(
				Effect.flatMap(ArtifactSessions, (service) =>
					service.revoke({ scope: { serverUrl, userId }, sessionId }),
				),
			),
		[runtime, serverUrl, userId],
	);

	useLayoutEffect(
		() => () => {
			header.clear(installation.installationId);
			onScreenState(null);
		},
		[
			header,
			installation.sourceHash,
			installation.installationId,
			installation.clientArtifactHash,
			onScreenState,
		],
	);

	return (
		<PluginHost
			theme={theme}
			onStaleSession={refetch}
			installation={installation}
			chromeLeading={chromeLeading}
			safeAreaTop={chrome.safeAreaTop}
			onOpenDrawer={chrome.onOpenDrawer}
			chromeTriggerRef={chrome.triggerRef}
			onNavigateBack={() => router.history.back()}
			onRenewArtifactSession={onRenewArtifactSession}
			onCreateArtifactSession={onCreateArtifactSession}
			onRevokeArtifactSession={onRevokeArtifactSession}
			artifactSessionScopeKey={`${serverUrl}\0${userId}`}
			onHeader={(publication) => header.publish(installation.installationId, publication)}
			onNavigate={(request) => {
				void navigate({ href: request.href, replace: request.replace });
			}}
			navigation={{
				...entry,
				compact: edge.compact,
				leading: edge.intent,
				edgeBack: edge.owner === "plugin" && edge.intent === "back",
				location: props.target.location,
			}}
			onQuery={(request, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginQueriesService, (service) => service.query({ scope, request })),
					{ signal },
				)
			}
			onInvokeOperation={(request, sourceHash, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginOperationsService, (service) =>
						service.invoke({ scope, request, sourceHash, pluginSlug: installation.slug }),
					),
					{ signal },
				)
			}
			onScreenState={(state) => {
				if (state === null) {
					header.clear(installation.installationId);
					onScreenState(null);
					return;
				}
				onScreenState({
					...state,
					sourceHash: installation.sourceHash,
					artifactHash: installation.clientArtifactHash,
					installationId: installation.installationId,
				});
			}}
		/>
	);
}
