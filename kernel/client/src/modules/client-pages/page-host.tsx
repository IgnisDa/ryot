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
import { ClientPageFreshness } from "#/modules/client-pages/freshness";
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
import { pluginStorageOutcome } from "#/modules/plugins/storage";
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

export const documentGrantSrc = (scope: ApiScope, src: string) =>
	new URL(src, `${scope.serverUrl}/`).toString();

const documentOwner = ({ context, identity }: PreparedClientPage) => {
	const documentId = "savedViewId" in identity ? identity.savedViewId : "";
	const documentRevision = "viewRevision" in identity ? identity.viewRevision : 0;
	const contextDigest = digest({
		view: context.view,
		route: context.route,
		settings: context.settings,
		renderer: context.renderer,
		dataSources: context.dataSources,
		target: {
			...context.target,
			...(context.target.kind === "plugin-route" ? { search: undefined } : {}),
		},
	});
	return `${identity.kind}:${documentId}:${documentRevision}:${contextDigest}`;
};

type FrameEntry = {
	readonly key: string;
	readonly generation: number;
	readonly compositionHash: string;
	readonly location: { readonly pathname: string; readonly searchStr: string };
	readonly document: ClientPageDocument;
	readonly operationTargets: PreparedClientPage["identity"]["operationTargets"];
	readonly navigation: PluginBridgeNavigationState;
};

type FramePool = {
	readonly activeKey: string | null;
	readonly entries: ReadonlyMap<string, FrameEntry>;
};

export function retainCompositionRuntime<T>(
	entries: ReadonlyMap<string, T>,
	key: string,
	value: T,
) {
	const next = new Map(entries);
	next.delete(key);
	next.set(key, value);
	while (next.size > MAX_RETAINED_FRAMES) {
		const oldest = next.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		next.delete(oldest);
	}
	return next;
}

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
	const [reloadRequest, setReloadRequest] = useState<{
		readonly key: string;
		readonly pathname: string;
		readonly searchStr: string;
		readonly navigationKey: string;
		readonly previousDocument: ClientPageDocument | null;
	}>();
	const scopeKey = `${scope.serverUrl}\0${scope.userId}`;
	const [poolScope, setPoolScope] = useState(scopeKey);

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
						Match.when({ kind: "plugin-route" }, ({ path, pluginSlug }) =>
							rendererContributor?.kind === "plugin"
								? toPluginLocation(pluginSlug, location.pathname, location.searchStr)
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

	const scopeChanged = poolScope !== scopeKey;
	if (scopeChanged) {
		setPoolScope(scopeKey);
		setReloadRequest(undefined);
		setPool({ activeKey: null, entries: new Map() });
	}
	const [syncedPool, setSyncedPool] = useState<{
		readonly document: ClientPageDocument | null;
		readonly pathname: string;
		readonly searchStr: string;
		readonly navigation: PluginBridgeNavigationState | undefined;
	}>();
	if (
		syncedPool === undefined ||
		syncedPool.document !== document ||
		syncedPool.navigation !== navigation ||
		syncedPool.pathname !== location.pathname ||
		syncedPool.searchStr !== location.searchStr
	) {
		setSyncedPool({
			document,
			navigation,
			pathname: location.pathname,
			searchStr: location.searchStr,
		});
		const syncPool = () => {
			if (document === null || navigation === undefined) {
				if (document === null) {
					setReloadRequest(undefined);
					setPool((current) =>
						current.activeKey === null ? current : { ...current, activeKey: null },
					);
				}
				return;
			}
			const compositionHash = document.prepared.composition.hash;
			const requested = scopeChanged ? undefined : reloadRequest;
			if (requested !== undefined && requested.previousDocument !== document) {
				setReloadRequest(undefined);
				if (
					requested.navigationKey === navigation.key &&
					requested.pathname === location.pathname &&
					requested.searchStr === location.searchStr
				) {
					setPool((current) => {
						const previous = current.entries.get(requested.key);
						if (
							current.activeKey !== requested.key ||
							previous?.navigation.key !== requested.navigationKey
						) {
							return current;
						}
						const existing = [...current.entries.values()].find(
							(candidate) => candidate.compositionHash === compositionHash,
						);
						const generation = (existing?.generation ?? -1) + 1;
						const key = `${compositionHash}:${generation}`;
						const next = new Map(current.entries);
						next.delete(requested.key);
						if (existing !== undefined) {
							next.delete(existing.key);
						}
						return {
							activeKey: key,
							entries: retainCompositionRuntime(next, key, {
								key,
								document,
								generation,
								navigation,
								compositionHash,
								operationTargets: document.prepared.identity.operationTargets,
								location: { pathname: location.pathname, searchStr: location.searchStr },
							}),
						};
					});
					return;
				}
			}
			setPool((current) => {
				const active =
					current.activeKey === null ? undefined : current.entries.get(current.activeKey);
				if (
					active?.navigation.key === navigation.key &&
					active.location.pathname === location.pathname &&
					active.location.searchStr === location.searchStr &&
					(active.compositionHash !== compositionHash ||
						documentOwner(active.document.prepared) !== documentOwner(document.prepared))
				) {
					return current;
				}
				const existing = [...current.entries.values()].find(
					(candidate) => candidate.compositionHash === compositionHash,
				);
				const generation = existing?.generation ?? 0;
				const key = existing?.key ?? `${compositionHash}:${generation}`;
				const next = retainCompositionRuntime(current.entries, key, {
					key,
					document,
					generation,
					navigation,
					compositionHash,
					operationTargets: document.prepared.identity.operationTargets,
					location: { pathname: location.pathname, searchStr: location.searchStr },
				});
				return { entries: next, activeKey: key };
			});
		};
		syncPool();
	}

	const displayedKey = rendersPluginSurface ? activeKey : null;
	const activeDocument = displayedKey === null ? undefined : entries.get(displayedKey)?.document;
	useLayoutEffect(() => {
		if (displayedKey === null || activeDocument === undefined) {
			return undefined;
		}
		header.activate(displayedKey);
		screen.activate(displayedKey);
		return () => {
			overlay.clear(displayedKey);
			screen.clear(displayedKey);
			header.clear(displayedKey);
		};
	}, [displayedKey, activeDocument, header, overlay, screen]);

	const reloadCurrent = useCallback(
		(key: string) => {
			const before = entries.get(key);
			if (before === undefined) {
				return;
			}
			const request = {
				key,
				previousDocument: document,
				pathname: before.location.pathname,
				searchStr: before.location.searchStr,
				navigationKey: before.navigation.key,
			};
			setReloadRequest(request);
			void router
				.invalidate()
				.catch(() => setReloadRequest((current) => (current === request ? undefined : current)));
		},
		[document, entries, router],
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
							owner={frameEntry.key}
							edgeLeading={chromeLeading}
							document={frameEntry.document}
							backInterceptors={backInterceptors}
							freshnessCheckRevision={invalidationRevision}
							operationTargets={frameEntry.operationTargets}
							onReloadCurrent={() => reloadCurrent(frameEntry.key)}
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
	readonly freshnessCheckRevision: number;
	readonly onReloadCurrent: () => void;
}) {
	const ryot = useRyot();
	const router = useRouter();
	const navigate = useNavigate();
	const active = useRef(props.active);
	const { context, identity } = props.document.prepared;
	const rendererPluginId =
		context.renderer.kind === "plugin" ? context.renderer.pluginId : undefined;
	const rendererContributor = identity.contributors.find(
		(contributor) => contributor.kind === "plugin" && contributor.pluginId === rendererPluginId,
	);

	const checkFreshness = useCallback(
		(signal: AbortSignal) =>
			props.runtime.runPromise(
				Effect.flatMap(ClientPageFreshness, (freshness) => freshness.check(props.scope, identity)),
				{ signal },
			),
		[identity, props.runtime, props.scope],
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
		active.current = props.active;
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
			chromeLeading={props.edgeLeading}
			onCheckFreshness={checkFreshness}
			onReloadCurrent={props.onReloadCurrent}
			onOpenDrawer={props.chrome.onOpenDrawer}
			backInterceptors={props.backInterceptors}
			chromeTriggerRef={props.chrome.triggerRef}
			mutationCompleted={ryot.mutationCompleted}
			onNavigateBack={() => router.history.back()}
			onKernelShortcut={props.chrome.onKernelShortcut}
			documentKey={documentOwner(props.document.prepared)}
			freshnessCheckRevision={props.freshnessCheckRevision}
			compositionHash={props.document.prepared.composition.hash}
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
			onStorage={(request, signal) =>
				props.runtime.runPromise(
					pluginStorageOutcome(props.scope, identity.contributors, request),
					{ signal },
				)
			}
			documentGrant={{
				...props.document.prepared.composition.documentGrant,
				src: documentGrantSrc(props.scope, props.document.prepared.composition.documentGrant.src),
			}}
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
