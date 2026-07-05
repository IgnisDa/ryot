import type { KernelShortcut } from "@ryot-app/client-plugin-contract";
import { useRyot } from "@ryot-app/client-sdk/react";
import { useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useCallback, useLayoutEffect, useMemo, type ReactNode } from "react";

import { resolveManagedAssetOutcome } from "#/modules/assets/managed-assets";
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
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onScreenState: (state: PluginDestinationScreenState | null) => void;
}) {
	return props.target === null ? (
		props.children
	) : (
		<PluginInstallation
			target={props.target}
			onScreenState={props.onScreenState}
			onKernelShortcut={props.onKernelShortcut}
		/>
	);
}

function PluginInstallation(props: {
	readonly target: ActivePluginDestination;
	readonly onKernelShortcut: (shortcut: KernelShortcut) => void;
	readonly onScreenState: (state: PluginDestinationScreenState | null) => void;
}) {
	const edge = useEdge();
	const ryot = useRyot();
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

	const viewport = useMemo(
		() => ({ safeAreaTop: chrome.safeAreaTop, safeAreaBottom: chrome.safeAreaBottom }),
		[chrome.safeAreaTop, chrome.safeAreaBottom],
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
			viewport={viewport}
			onStaleSession={refetch}
			installation={installation}
			chromeLeading={chromeLeading}
			onOpenDrawer={chrome.onOpenDrawer}
			watchEntities={ryot.entities.watch}
			chromeTriggerRef={chrome.triggerRef}
			onKernelShortcut={props.onKernelShortcut}
			onNavigateBack={() => router.history.back()}
			onRenewArtifactSession={onRenewArtifactSession}
			onCreateArtifactSession={onCreateArtifactSession}
			onRevokeArtifactSession={onRevokeArtifactSession}
			artifactSessionScopeKey={`${serverUrl}\0${userId}`}
			onHeader={(publication) => header.publish(installation.installationId, publication)}
			onNavigate={(request) => {
				void navigate({ href: request.href, replace: request.replace });
			}}
			onAssets={(request, signal) =>
				runtime.runPromise(resolveManagedAssetOutcome(scope, request.assets), { signal })
			}
			navigation={{
				...entry,
				leading: edge.intent,
				compact: edge.compact,
				location: props.target.location,
				edgeBack: edge.owner === "plugin" && edge.intent === "back",
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
					installationId: installation.installationId,
					artifactHash: installation.clientArtifactHash,
				});
			}}
		/>
	);
}
