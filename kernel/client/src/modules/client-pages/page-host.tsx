import { useRyot } from "@ryot-app/client-sdk/react";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { Effect } from "effect";
import { useCallback, useLayoutEffect, useMemo } from "react";

import { resolveManagedAssetOutcome } from "#/modules/assets/managed-assets";
import { temporaryUploadOutcome } from "#/modules/assets/temporary-uploads";
import { ClientPageSessions, ClientPageSessionStale } from "#/modules/client-pages/sessions";
import { useScreenLeadingControl } from "#/modules/navigation/app-screen";
import {
	useEdge,
	usePluginHeader,
	useShellChrome,
} from "#/modules/navigation/authenticated-shell-context";
import { historyEntry } from "#/modules/navigation/history-entry";
import { PluginFrame } from "#/modules/plugins/plugin-host";
import { PluginQueriesService } from "#/modules/plugins/queries";

export function ClientPageHost(props: { readonly prepared: PreparedClientPage }) {
	const ryot = useRyot();
	const edge = useEdge();
	const router = useRouter();
	const chrome = useShellChrome();
	const header = usePluginHeader();
	const chromeLeading = useScreenLeadingControl();
	const { runtime, scope, theme } = useRouteContext({ from: "/_authenticated" });
	const state = useRouterState({ select: (current) => current.location.state });
	const entry = historyEntry(state);
	const { identity, context } = props.prepared;
	const owner = identity.rendererId;

	const createSession = useCallback(
		(_request: unknown, signal: AbortSignal) =>
			runtime.runPromise(
				Effect.flatMap(ClientPageSessions, (sessions) => sessions.create(scope, identity)).pipe(
					Effect.tapError((error) =>
						error instanceof ClientPageSessionStale
							? Effect.promise(() => router.invalidate()).pipe(Effect.asVoid)
							: Effect.void,
					),
				),
				{ signal },
			),
		[identity, router, runtime, scope],
	);
	const renewSession = useCallback(
		(sessionId: string, signal: AbortSignal) =>
			runtime.runPromise(
				Effect.flatMap(ClientPageSessions, (sessions) => sessions.renew(scope, sessionId)),
				{ signal },
			),
		[runtime, scope],
	);
	const revokeSession = useCallback(
		(sessionId: string) =>
			runtime.runPromise(
				Effect.flatMap(ClientPageSessions, (sessions) => sessions.revoke(scope, sessionId)),
			),
		[runtime, scope],
	);
	const viewport = useMemo(
		() => ({ safeAreaTop: chrome.safeAreaTop, safeAreaBottom: chrome.safeAreaBottom }),
		[chrome.safeAreaBottom, chrome.safeAreaTop],
	);

	useLayoutEffect(() => () => header.clear(owner), [header, owner]);

	return (
		<PluginFrame
			theme={theme}
			pluginSlug=""
			page={context}
			viewport={viewport}
			onNavigate={() => undefined}
			chromeLeading={chromeLeading}
			onScreenState={() => undefined}
			onOpenDrawer={chrome.onOpenDrawer}
			onKernelShortcut={() => undefined}
			watchEntities={ryot.entities.watch}
			sourceHash={identity.publishedHash}
			artifactHash={identity.artifactHash}
			installationId={identity.rendererId}
			chromeTriggerRef={chrome.triggerRef}
			onRenewArtifactSession={renewSession}
			onCreateArtifactSession={createSession}
			onRevokeArtifactSession={revokeSession}
			onNavigateBack={() => router.history.back()}
			onStaleSession={() => void router.invalidate()}
			key={`${identity.savedViewId}\0${identity.viewRevision}`}
			artifactSessionScopeKey={`${scope.serverUrl}\0${scope.userId}`}
			onHeader={(publication) => header.publish(owner, publication)}
			onInvokeOperation={() => Promise.resolve({ outcome: "failure", reason: "operation-failed" })}
			onUpload={(request, signal) =>
				runtime.runPromise(temporaryUploadOutcome(scope, request), { signal })
			}
			onAssets={(request, signal) =>
				runtime.runPromise(resolveManagedAssetOutcome(scope, request.assets), { signal })
			}
			navigation={{
				...entry,
				leading: edge.intent,
				compact: edge.compact,
				location: { kind: "route", path: "/", search: "" },
				edgeBack: edge.owner === "plugin" && edge.intent === "back",
			}}
			onQuery={(request, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginQueriesService, (service) => service.query({ scope, request })),
					{ signal },
				)
			}
		/>
	);
}
