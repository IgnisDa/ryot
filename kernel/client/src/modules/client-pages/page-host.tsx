import type {
	PluginLogicalLocation,
	PluginPageSearchUpdate,
	PluginBridgeProviderSearchScreen,
} from "@ryot-app/client-plugin-contract";
import { RyotClientError } from "@ryot-app/client-sdk";
import { useRyot } from "@ryot-app/client-sdk/react";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { useNavigate, useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { Effect, Match } from "effect";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { resolveManagedAssetOutcome } from "#/modules/assets/managed-assets";
import { temporaryUploadOutcome } from "#/modules/assets/temporary-uploads";
import { ClientPageSessions, ClientPageSessionStale } from "#/modules/client-pages/sessions";
import { useScreenLeadingControl } from "#/modules/navigation/app-screen";
import {
	useClientPageScreen,
	useClientPageOverlay,
	useEdge,
	usePluginHeader,
	usePluginTitle,
	useShellChrome,
} from "#/modules/navigation/authenticated-shell-context";
import { historyEntry } from "#/modules/navigation/history-entry";
import { usePageTitle } from "#/modules/navigation/page-title";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginFrame } from "#/modules/plugins/plugin-host";
import { toPluginLocation } from "#/modules/plugins/plugin-location";
import { PluginQueriesService } from "#/modules/plugins/queries";

const searchString = (value: string) => (value.startsWith("?") ? value.slice(1) : value);

export function mergePageSearch(current: string, update: PluginPageSearchUpdate) {
	const next = new URLSearchParams(searchString(current));
	for (const [key, value] of Object.entries(update)) {
		if (value === null) {
			next.delete(key);
		} else {
			next.set(key, value);
		}
	}
	return next.toString();
}

export function ClientPageHost(props: {
	readonly title: string;
	readonly inert?: boolean;
	readonly prepared: PreparedClientPage;
	readonly onProviderSearch?: (request: PluginBridgeProviderSearchScreen) => void;
}) {
	const ryot = useRyot();
	const edge = useEdge();
	const router = useRouter();
	const navigate = useNavigate();
	const chrome = useShellChrome();
	const header = usePluginHeader();
	const screen = useClientPageScreen();
	const overlay = useClientPageOverlay();
	const publishedTitle = usePluginTitle();
	const chromeLeading = useScreenLeadingControl();
	const { invalidationRevision } = usePluginCatalog();
	const { scope, theme, runtime, backInterceptors } = useRouteContext({ from: "/_authenticated" });
	const location = useRouterState({
		select: (current) => current.resolvedLocation ?? current.location,
	});
	const entry = historyEntry(location.state);
	const { context, identity } = props.prepared;
	const documentId = identity.target.kind === "saved-view" ? identity.target.savedViewId : "";
	const documentRevision = "viewRevision" in identity ? identity.viewRevision : 0;
	const baseOwner = `${identity.kind}:${identity.buildId}:${identity.graphHash}:${identity.artifactHash}:${documentId}:${documentRevision}`;
	const baseOwnerRef = useRef(baseOwner);
	const [documentGeneration, setDocumentGeneration] = useState(0);
	baseOwnerRef.current = baseOwner;
	const owner = `${baseOwner}:${documentGeneration}`;
	const operationTargets = useRef({ owner, targets: identity.operationTargets });
	if (operationTargets.current.owner !== owner) {
		operationTargets.current = { owner, targets: identity.operationTargets };
	}
	const rendererPluginId =
		context.renderer.kind === "plugin" ? context.renderer.pluginId : undefined;
	const rendererContributor = identity.contributors.find(
		(contributor) => contributor.kind === "plugin" && contributor.pluginId === rendererPluginId,
	);
	const search = searchString(location.searchStr);
	const logicalLocation: PluginLogicalLocation = Match.value(context.target).pipe(
		Match.when({ kind: "plugin-route" }, ({ path }) =>
			rendererContributor?.kind === "plugin"
				? toPluginLocation(rendererContributor.pluginSlug, location.pathname, location.searchStr)
				: { path, search, kind: "route" as const },
		),
		Match.when({ kind: "entity" }, ({ entityId, entitySchemaSlug }) => ({
			search,
			entityId,
			entitySchemaSlug,
			kind: "entity" as const,
		})),
		Match.when({ kind: "saved-view" }, () => ({
			search,
			kind: "route" as const,
			path: location.pathname,
		})),
		Match.exhaustive,
	);
	usePageTitle(publishedTitle ?? props.title);

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
	const reloadCurrent = useCallback(async () => {
		const reloadedOwner = baseOwnerRef.current;
		await router.invalidate();
		if (baseOwnerRef.current === reloadedOwner) {
			setDocumentGeneration((generation) => generation + 1);
		}
	}, [router]);
	const viewport = useMemo(
		() => ({ safeAreaTop: chrome.safeAreaTop, safeAreaBottom: chrome.safeAreaBottom }),
		[chrome.safeAreaBottom, chrome.safeAreaTop],
	);

	useLayoutEffect(() => {
		header.activate(owner);
		screen.activate(owner);
		return () => {
			overlay.clear(owner);
			screen.clear(owner);
			header.clear(owner);
		};
	}, [header, overlay, owner, screen]);

	return (
		<PluginFrame
			key={owner}
			theme={theme}
			page={context}
			inert={props.inert}
			viewport={viewport}
			chromeLeading={chromeLeading}
			sourceHash={identity.graphHash}
			installationId={identity.buildId}
			onOpenDrawer={chrome.onOpenDrawer}
			backInterceptors={backInterceptors}
			watchEntities={ryot.entities.watch}
			artifactHash={identity.artifactHash}
			chromeTriggerRef={chrome.triggerRef}
			onRenewArtifactSession={renewSession}
			onCreateArtifactSession={createSession}
			onRevokeArtifactSession={revokeSession}
			mutationCompleted={ryot.mutationCompleted}
			onKernelShortcut={chrome.onKernelShortcut}
			onNavigateBack={() => router.history.back()}
			onReloadCurrent={() => void reloadCurrent()}
			freshnessCheckRevision={invalidationRevision}
			onScreenState={(state) => screen.publish(owner, state)}
			onOverlayState={(count) => overlay.publish(owner, count)}
			onHeader={(publication) => header.publish(owner, publication)}
			artifactSessionScopeKey={`${scope.serverUrl}\0${scope.userId}`}
			onProviderSearch={(request) => props.onProviderSearch?.(request)}
			title={rendererContributor?.kind === "plugin" ? rendererContributor.pluginSlug : props.title}
			onUpload={(request, signal) =>
				runtime.runPromise(temporaryUploadOutcome(scope, request), { signal })
			}
			onAssets={(request, signal) =>
				runtime.runPromise(resolveManagedAssetOutcome(scope, request.assets), { signal })
			}
			onQuery={(request, signal) =>
				runtime.runPromise(
					Effect.flatMap(PluginQueriesService, (service) => service.query({ scope, request })),
					{ signal },
				)
			}
			navigation={{
				...entry,
				leading: edge.intent,
				compact: edge.compact,
				location: logicalLocation,
				edgeBack: edge.owner === "plugin" && edge.intent === "back",
			}}
			onNavigate={(request) =>
				void navigate({
					href: request.href,
					replace: request.replace,
					state: (current) => ({ ...current, ryotEntryKey: crypto.randomUUID() }),
				})
			}
			onPageSearch={({ mode, update }) => {
				const nextSearch = mergePageSearch(location.searchStr, update);
				const href = `${location.pathname}${nextSearch === "" ? "" : `?${nextSearch}`}`;
				void navigate({
					href,
					replace: mode === "replace",
					state: (current) => ({
						...current,
						ryotEntryKey: mode === "replace" ? entry.key : crypto.randomUUID(),
					}),
				});
			}}
			onInvokeOperation={(request, signal) => {
				const target = operationTargets.current.targets.find(
					(candidate) => candidate.pluginSlug === request.pluginSlug,
				);
				if (target === undefined) {
					return Promise.resolve({
						outcome: "failure" as const,
						reason: "operation-failed" as const,
					});
				}
				return runtime.runPromise(
					Effect.flatMap(PluginOperationsService, (service) =>
						service.invoke({ scope, request, sourceHash: target.sourceHash }),
					),
					{ signal },
				);
			}}
			onCollection={async (request) => {
				try {
					let response;
					if (request.action === "create") {
						response = await ryot.collections.create(request.input);
					} else if (request.action === "upsert-membership") {
						response = await ryot.collections.upsertMembership(request.input);
					} else {
						response = await ryot.collections.removeMembership(request.input);
					}
					return { response, outcome: "success" as const };
				} catch (error) {
					return {
						outcome: "failure" as const,
						reason:
							error instanceof RyotClientError && error.reason === "collection-failed"
								? "collection-failed"
								: "transport",
					};
				}
			}}
		/>
	);
}
