import { sha256 } from "@noble/hashes/sha2.js";
import type { PluginPageSearchUpdate } from "@ryot-app/client-plugin-contract";
import { RyotClientError } from "@ryot-app/client-sdk";
import { useRyot } from "@ryot-app/client-sdk/react";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { useNavigate, useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { Effect, Match } from "effect";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ApiScope } from "#/api/scope";
import { resolveManagedAssetOutcome } from "#/modules/assets/managed-assets";
import { temporaryUploadOutcome } from "#/modules/assets/temporary-uploads";
import {
	type ClientPageDocument,
	usePublishedClientPageDocument,
} from "#/modules/client-pages/document";
import { ClientPageSessions, ClientPageSessionStale } from "#/modules/client-pages/sessions";
import { EntityInterestService, type WatchEntities } from "#/modules/entity-interest/service";
import { useScreenLeadingControl } from "#/modules/navigation/app-screen";
import {
	type ClientPageOverlayController,
	type ClientPageScreenController,
	type PluginHeaderController,
	type ShellChrome,
	useClientPageOverlay,
	useClientPageScreen,
	useEdge,
	usePluginHeader,
	usePluginTitle,
	useShellChrome,
} from "#/modules/navigation/authenticated-shell-context";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { historyEntry } from "#/modules/navigation/history-entry";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import type { PluginBridgeNavigationState } from "#/modules/plugins/bridge";
import { usePluginCatalog } from "#/modules/plugins/catalog-provider";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginFrame } from "#/modules/plugins/plugin-host";
import { toPluginLocation } from "#/modules/plugins/plugin-location";
import { PluginQueriesService } from "#/modules/plugins/queries";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

const MAX_RETAINED_FRAMES = 3;
const pluginRouteIds = new Set([
	"/_authenticated/$pluginSlug",
	"/_authenticated/e/$entityId",
	"/_authenticated/v/$viewSlug",
]);
const searchString = (value: string) => (value.startsWith("?") ? value.slice(1) : value);
const digest = (value: unknown) =>
	Array.from(sha256(new TextEncoder().encode(stableStringify(value))), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

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

const documentOwner = ({ context, identity }: PreparedClientPage) => {
	const documentId = identity.target.kind === "saved-view" ? identity.target.savedViewId : "";
	const documentRevision = "viewRevision" in identity ? identity.viewRevision : 0;
	const contextDigest = digest({
		view: context.view,
		settings: context.settings,
		renderer: context.renderer,
		targetKind: context.target.kind,
		dataSources: context.dataSources,
	});
	return `${identity.kind}:${identity.buildId}:${identity.graphHash}:${identity.artifactHash}:${documentId}:${documentRevision}:${contextDigest}`;
};

type FrameEntry = {
	readonly key: string;
	readonly generation: number;
	readonly baseOwner: string;
	readonly location: { readonly pathname: string; readonly searchStr: string };
	readonly document: ClientPageDocument;
	readonly operationTargets: PreparedClientPage["identity"]["operationTargets"];
	readonly navigation: PluginBridgeNavigationState;
};

type FramePool = {
	readonly activeKey: string | null;
	readonly entries: ReadonlyMap<string, FrameEntry>;
};

export function ClientPageDocumentHost() {
	const edge = useEdge();
	const router = useRouter();
	const chrome = useShellChrome();
	const header = usePluginHeader();
	const screen = useClientPageScreen();
	const overlay = useClientPageOverlay();
	const publishedTitle = usePluginTitle();
	const chromeLeading = useScreenLeadingControl();
	const document = usePublishedClientPageDocument();
	const { invalidationRevision } = usePluginCatalog();
	const { scope, theme, runtime, backInterceptors } = useRouteContext({ from: "/_authenticated" });
	const location = useRouterState({
		select: (current) => current.resolvedLocation ?? current.location,
	});
	const rendersPluginSurface = useRouterState({
		select: (state) => state.matches.some((match) => pluginRouteIds.has(match.routeId)),
	});
	const [pool, setPool] = useState<FramePool>(() => ({ activeKey: null, entries: new Map() }));
	const { entries, activeKey } = pool;
	const entriesRef = useRef(entries);
	const activeKeyRef = useRef(activeKey);
	entriesRef.current = entries;
	activeKeyRef.current = activeKey;
	const scopeKey = `${scope.serverUrl}\0${scope.userId}`;
	const previousScope = useRef(scopeKey);

	const rendererContributor = document?.prepared.identity.contributors.find(
		(contributor) =>
			contributor.kind === "plugin" &&
			contributor.pluginId ===
				(document.prepared.context.renderer.kind === "plugin"
					? document.prepared.context.renderer.pluginId
					: undefined),
	);
	const logicalLocation = useMemo(
		() =>
			document
				? Match.value(document.prepared.context.target).pipe(
						Match.when({ kind: "plugin-route" }, ({ path }) =>
							rendererContributor?.kind === "plugin"
								? toPluginLocation(
										rendererContributor.pluginSlug,
										location.pathname,
										location.searchStr,
									)
								: { path, kind: "route" as const, search: searchString(location.searchStr) },
						),
						Match.when({ kind: "entity" }, ({ entityId, entitySchemaSlug }) => ({
							entityId,
							entitySchemaSlug,
							kind: "entity" as const,
							search: searchString(location.searchStr),
						})),
						Match.when({ kind: "saved-view" }, () => ({
							kind: "route" as const,
							path: location.pathname,
							search: searchString(location.searchStr),
						})),
						Match.exhaustive,
					)
				: undefined,
		[document, location.pathname, location.searchStr, rendererContributor],
	);
	const entry = useMemo(() => historyEntry(location.state), [location.state]);
	const navigation = useMemo<PluginBridgeNavigationState | undefined>(
		() =>
			logicalLocation
				? {
						...entry,
						leading: edge.intent,
						compact: edge.compact,
						location: logicalLocation,
						edgeBack: edge.owner === "plugin" && edge.intent === "back",
					}
				: undefined,
		[edge.compact, edge.intent, edge.owner, entry, logicalLocation],
	);

	useLayoutEffect(() => {
		if (previousScope.current === scopeKey) {
			return;
		}
		previousScope.current = scopeKey;
		setPool({ activeKey: null, entries: new Map() });
	}, [scopeKey]);

	useLayoutEffect(() => {
		if (document === null || navigation === undefined) {
			if (document === null) {
				setPool((current) =>
					current.activeKey === null ? current : { ...current, activeKey: null },
				);
			}
			return;
		}
		const baseOwner = documentOwner(document.prepared);
		setPool((current) => {
			const next = new Map(current.entries);
			const existing = [...next.values()].find((candidate) => candidate.baseOwner === baseOwner);
			const generation = existing?.generation ?? 0;
			const key = existing?.key ?? `${baseOwner}:${generation}`;
			if (existing) {
				next.delete(existing.key);
			}
			next.set(key, {
				key,
				document,
				baseOwner,
				generation,
				navigation,
				location: { pathname: location.pathname, searchStr: location.searchStr },
				operationTargets: existing?.operationTargets ?? document.prepared.identity.operationTargets,
			});
			while (next.size > MAX_RETAINED_FRAMES) {
				const evicted = [...next.keys()].find((candidate) => candidate !== key);
				if (evicted === undefined) {
					break;
				}
				next.delete(evicted);
			}
			return { entries: next, activeKey: key };
		});
	}, [document, location.pathname, location.searchStr, navigation]);

	const displayedKey = rendersPluginSurface ? activeKey : null;
	useLayoutEffect(() => {
		if (displayedKey === null) {
			return undefined;
		}
		header.activate(displayedKey);
		screen.activate(displayedKey);
		return () => {
			overlay.clear(displayedKey);
			screen.clear(displayedKey);
			header.clear(displayedKey);
		};
	}, [displayedKey, header, overlay, screen]);

	const reloadCurrent = useCallback(
		async (key: string) => {
			const before = entriesRef.current.get(key);
			if (before === undefined) {
				return;
			}
			await router.invalidate();
			if (
				activeKeyRef.current !== key ||
				entriesRef.current.get(key)?.baseOwner !== before.baseOwner
			) {
				return;
			}
			const nextKey = `${before.baseOwner}:${before.generation + 1}`;
			setPool((current) => {
				const currentEntry = current.entries.get(key);
				if (currentEntry === undefined) {
					return current;
				}
				const next = new Map(current.entries);
				next.delete(key);
				next.set(nextKey, {
					...currentEntry,
					key: nextKey,
					generation: currentEntry.generation + 1,
					operationTargets: currentEntry.document.prepared.identity.operationTargets,
				});
				return { entries: next, activeKey: nextKey };
			});
		},
		[router],
	);

	if (entries.size === 0) {
		return null;
	}
	const activeEntry = displayedKey === null ? undefined : entries.get(displayedKey);
	return (
		<main
			{...(activeEntry ? mainContentProps : {})}
			aria-hidden={activeEntry ? undefined : true}
			className="absolute inset-0 min-h-0 overflow-hidden"
			style={{ visibility: activeEntry ? "visible" : "hidden" }}
		>
			{activeEntry ? (
				<ClientPageTitle title={publishedTitle ?? activeEntry.document.title} />
			) : null}
			{[...entries.values()].map((frameEntry) => {
				const active = frameEntry.key === displayedKey;
				return (
					<div
						key={frameEntry.key}
						className="absolute inset-0"
						aria-hidden={active ? undefined : true}
						style={{ visibility: active ? "visible" : "hidden" }}
					>
						<ClientPageFrame
							theme={theme}
							scope={scope}
							active={active}
							chrome={chrome}
							header={header}
							screen={screen}
							runtime={runtime}
							overlay={overlay}
							scopeKey={scopeKey}
							owner={frameEntry.key}
							edgeLeading={chromeLeading}
							document={frameEntry.document}
							backInterceptors={backInterceptors}
							freshnessCheckRevision={invalidationRevision}
							operationTargets={frameEntry.operationTargets}
							onReloadCurrent={() => void reloadCurrent(frameEntry.key)}
							navigation={active && navigation ? navigation : frameEntry.navigation}
							location={
								active
									? { pathname: location.pathname, searchStr: location.searchStr }
									: frameEntry.location
							}
						/>
					</div>
				);
			})}
		</main>
	);
}

function ClientPageTitle(props: { readonly title: string }) {
	usePageTitle(props.title);
	return null;
}

function ClientPageFrame(props: {
	readonly active: boolean;
	readonly owner: string;
	readonly document: ClientPageDocument;
	readonly operationTargets: PreparedClientPage["identity"]["operationTargets"];
	readonly navigation: PluginBridgeNavigationState;
	readonly location: { readonly pathname: string; readonly searchStr: string };
	readonly theme: ThemeStore;
	readonly runtime: ClientRuntime;
	readonly scope: ApiScope;
	readonly chrome: ShellChrome;
	readonly header: PluginHeaderController;
	readonly screen: ClientPageScreenController;
	readonly overlay: ClientPageOverlayController;
	readonly edgeLeading: ReactNode;
	readonly backInterceptors: BackInterceptors;
	readonly scopeKey: string;
	readonly freshnessCheckRevision: number;
	readonly onReloadCurrent: () => void;
}) {
	const ryot = useRyot();
	const router = useRouter();
	const navigate = useNavigate();
	const active = useRef(props.active);
	active.current = props.active;
	const { context, identity } = props.document.prepared;
	const rendererPluginId =
		context.renderer.kind === "plugin" ? context.renderer.pluginId : undefined;
	const rendererContributor = identity.contributors.find(
		(contributor) => contributor.kind === "plugin" && contributor.pluginId === rendererPluginId,
	);

	const createSession = useCallback(
		(_request: unknown, signal: AbortSignal) =>
			props.runtime.runPromise(
				Effect.flatMap(ClientPageSessions, (sessions) =>
					sessions.create(props.scope, identity),
				).pipe(
					Effect.tapError((error) =>
						error instanceof ClientPageSessionStale
							? Effect.promise(() => router.invalidate()).pipe(Effect.asVoid)
							: Effect.void,
					),
				),
				{ signal },
			),
		[identity, props.runtime, props.scope, router],
	);
	const renewSession = useCallback(
		(sessionId: string, signal: AbortSignal) =>
			props.runtime.runPromise(
				Effect.flatMap(ClientPageSessions, (sessions) => sessions.renew(props.scope, sessionId)),
				{ signal },
			),
		[props.runtime, props.scope],
	);
	const revokeSession = useCallback(
		(sessionId: string) =>
			props.runtime.runPromise(
				Effect.flatMap(ClientPageSessions, (sessions) => sessions.revoke(props.scope, sessionId)),
			),
		[props.runtime, props.scope],
	);
	const watchEntities = useCallback<WatchEntities>(
		(interest, onUpdate) =>
			props.runtime.runSync(
				Effect.map(EntityInterestService, (service) =>
					service.watch(props.scope, interest, onUpdate, () => active.current),
				),
			),
		[props.runtime, props.scope],
	);
	useLayoutEffect(() => {
		props.runtime.runSync(
			Effect.map(EntityInterestService, (service) => service.refresh(props.scope)),
		);
	}, [props.active, props.runtime, props.scope]);
	const viewport = useMemo(
		() => ({ safeAreaTop: props.chrome.safeAreaTop, safeAreaBottom: props.chrome.safeAreaBottom }),
		[props.chrome.safeAreaBottom, props.chrome.safeAreaTop],
	);

	return (
		<PluginFrame
			page={context}
			theme={props.theme}
			viewport={viewport}
			active={props.active}
			inert={props.document.inert}
			navigation={props.navigation}
			watchEntities={watchEntities}
			sourceHash={identity.graphHash}
			chromeLeading={props.edgeLeading}
			installationId={identity.buildId}
			artifactHash={identity.artifactHash}
			onRenewArtifactSession={renewSession}
			onCreateArtifactSession={createSession}
			onRevokeArtifactSession={revokeSession}
			onReloadCurrent={props.onReloadCurrent}
			onOpenDrawer={props.chrome.onOpenDrawer}
			artifactSessionScopeKey={props.scopeKey}
			backInterceptors={props.backInterceptors}
			chromeTriggerRef={props.chrome.triggerRef}
			mutationCompleted={ryot.mutationCompleted}
			onNavigateBack={() => router.history.back()}
			onKernelShortcut={props.chrome.onKernelShortcut}
			freshnessCheckRevision={props.freshnessCheckRevision}
			onScreenState={(state) => props.screen.publish(props.owner, state)}
			onOverlayState={(count) => props.overlay.publish(props.owner, count)}
			onHeader={(publication) => props.header.publish(props.owner, publication)}
			onProviderSearch={(request) => props.document.onProviderSearch?.(request)}
			title={
				rendererContributor?.kind === "plugin"
					? rendererContributor.pluginSlug
					: props.document.title
			}
			onUpload={(request, signal) =>
				props.runtime.runPromise(temporaryUploadOutcome(props.scope, request), { signal })
			}
			onAssets={(request, signal) =>
				props.runtime.runPromise(resolveManagedAssetOutcome(props.scope, request.assets), {
					signal,
				})
			}
			onNavigate={(request) =>
				void navigate({
					href: request.href,
					replace: request.replace,
					state: (current) => ({ ...current, ryotEntryKey: crypto.randomUUID() }),
				})
			}
			onQuery={(request, signal) =>
				props.runtime.runPromise(
					Effect.flatMap(PluginQueriesService, (service) =>
						service.query({ request, scope: props.scope }),
					),
					{ signal },
				)
			}
			onPageSearch={({ mode, update }) => {
				const nextSearch = mergePageSearch(props.location.searchStr, update);
				const href = `${props.location.pathname}${nextSearch === "" ? "" : `?${nextSearch}`}`;
				void navigate({
					href,
					replace: mode === "replace",
					state: (current) => ({
						...current,
						ryotEntryKey: mode === "replace" ? props.navigation.key : crypto.randomUUID(),
					}),
				});
			}}
			onInvokeOperation={(request, signal) => {
				const target = props.operationTargets.find(
					(candidate) => candidate.pluginSlug === request.pluginSlug,
				);
				if (target === undefined) {
					return Promise.resolve({
						outcome: "failure" as const,
						reason: "operation-failed" as const,
					});
				}
				return props.runtime.runPromise(
					Effect.flatMap(PluginOperationsService, (service) =>
						service.invoke({ request, scope: props.scope, sourceHash: target.sourceHash }),
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
