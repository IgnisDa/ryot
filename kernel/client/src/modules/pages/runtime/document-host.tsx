import { sha256 } from "@noble/hashes/sha2.js";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type { PluginPageSearchUpdate } from "@ryot-app/plugin-client-contract";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import {
	useBlocker,
	useNavigate,
	useRouteContext,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { Effect, Match } from "effect";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { PagesApi } from "#/api/pages";
import { RyotQLApi } from "#/api/ryotql";
import type { ApiScope } from "#/api/scope";
import { ManagedAssetsService } from "#/modules/assets/managed-assets";
import { Uploads } from "#/modules/assets/uploads";
import { resolveBackgroundSubmissionTarget } from "#/modules/background-submissions/service";
import { useBackgroundSubmissionTray } from "#/modules/background-submissions/tray";
import { DeviceService } from "#/modules/device/service";
import { EntityWatchService, type WatchEntities } from "#/modules/entity-watches/service";
import { subscribeNativeResume } from "#/modules/entity-watches/transport";
import { ExternalLinks } from "#/modules/external-links/service";
import { IosLiveActivitiesService } from "#/modules/ios-live-activities/service";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { historyEntry } from "#/modules/navigation/history-entry";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { PluginCalendarSources } from "#/modules/pages/bridge/calendar-sources";
import { PluginEntitySaves } from "#/modules/pages/bridge/entity-saves";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";
import { PluginPopulationRetries } from "#/modules/pages/bridge/population-retry";
import { PluginQueriesService } from "#/modules/pages/bridge/queries";
import type { PluginBridgeNavigationState } from "#/modules/pages/bridge/session";
import { PluginStorage } from "#/modules/pages/bridge/storage";
import { pluginUserSettingsOutcome } from "#/modules/pages/bridge/user-settings";
import { renderClientDocument } from "#/modules/pages/documents/srcdoc";
import {
	type ClientPageDocument,
	usePublishedClientPageDocument,
} from "#/modules/pages/documents/state";
import { ClientPageFreshness } from "#/modules/pages/preparation/freshness";
import { PageIframeHost } from "#/modules/pages/runtime/iframe-host";
import { toPluginLocation } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { useScreenLeadingControl } from "#/modules/shell/app-screen";
import {
	type ClientPagePresentationController,
	type ShellChrome,
	useClientPagePresentation,
	useEdge,
	usePluginTitle,
	useShellChrome,
} from "#/modules/shell/authenticated-shell-context";
import type { ThemeStore } from "#/modules/theme/store";
import type { FileRoutesById } from "#/routeTree.gen";
import type { ClientRuntime } from "#/runtime";

const MAX_RETAINED_FRAMES = 3;
const pluginRouteIds = new Set<string>([
	"/_authenticated/p/$publisher/$name",
	"/_authenticated/e/$entityId",
	"/_authenticated/v/c/$savedViewId",
	"/_authenticated/v/k/$slug",
	"/_authenticated/v/p/$publisher/$name/$slug",
] satisfies ReadonlyArray<keyof FileRoutesById>);
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
	const presentation = useClientPagePresentation();
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
						Match.when({ kind: "plugin-route" }, ({ path, packageId }) =>
							rendererContributor?.kind === "plugin"
								? toPluginLocation(packageId, location.pathname, location.searchStr)
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
		presentation.activate(displayedKey);
		return () => presentation.deactivate(displayedKey);
	}, [displayedKey, activeDocument, presentation]);

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
			Effect.runFork(
				Effect.tryPromise(() => router.invalidate()).pipe(
					Effect.catch(() =>
						Effect.sync(() =>
							setReloadRequest((current) => (current === request ? undefined : current)),
						),
					),
				),
			);
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
			{/* Moving an iframe in the DOM reloads it, so surviving frames keep a fixed order. */}
			{sortBy([...entries.values()], (frameEntry) => frameEntry.key).map((frameEntry) => {
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
							runtime={runtime}
							owner={frameEntry.key}
							presentation={presentation}
							edgeLeading={chromeLeading}
							document={frameEntry.document}
							backInterceptors={backInterceptors}
							freshnessCheckRevision={invalidationRevision}
							operationTargets={frameEntry.operationTargets}
							onReloadCurrent={() => reloadCurrent(frameEntry.key)}
							navigation={active && navigation ? navigation : frameEntry.navigation}
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
	readonly owner: string;
	readonly active: boolean;
	readonly scope: ApiScope;
	readonly theme: ThemeStore;
	readonly chrome: ShellChrome;
	readonly runtime: ClientRuntime;
	readonly edgeLeading: ReactNode;
	readonly onReloadCurrent: () => void;
	readonly document: ClientPageDocument;
	readonly presentation: ClientPagePresentationController;
	readonly freshnessCheckRevision: number;
	readonly backInterceptors: BackInterceptors;
	readonly navigation: PluginBridgeNavigationState;
	readonly operationTargets: PreparedClientPage["identity"]["operationTargets"];
}) {
	const ryot = useRyot();
	const router = useRouter();
	const navigate = useNavigate();
	const active = useRef(props.active);
	const frameScope = useRef<ApiScope | undefined>(props.scope);
	const frameKey = `${props.owner}:${props.navigation.key}`;
	const flush = useRef<(() => Effect.Effect<boolean>) | undefined>(undefined);
	useBlocker({
		enableBeforeUnload: false,
		shouldBlockFn: () =>
			flush.current !== undefined
				? props.runtime.runPromise(flush.current().pipe(Effect.map((flushed) => !flushed)))
				: false,
	});
	const { catalog } = usePluginCatalog();
	const backgroundSubmissions = useBackgroundSubmissionTray();
	const { context, identity } = props.document.prepared;
	const renderer = context.renderer;
	const rendererPlugin =
		renderer.kind === "plugin"
			? catalog.find(({ pluginId }) => pluginId === renderer.pluginId)
			: undefined;

	const checkFreshness = useCallback(
		() => props.runtime.runSync(ClientPageFreshness).check(props.scope, identity),
		[identity, props.runtime, props.scope],
	);
	const subscribeResume = useCallback(
		(resumed: () => void) => {
			const removeNative = subscribeNativeResume(resumed);
			const removeAlerts = props.runtime.runSync(DeviceService).subscribeAlerts(resumed);
			return () => {
				removeNative();
				removeAlerts();
			};
		},
		[props.runtime],
	);
	const watchEntities = useCallback<WatchEntities>(
		(interest, onUpdate) =>
			props.runtime.runSync(
				Effect.map(EntityWatchService, (service) =>
					service.watch(props.scope, interest, onUpdate, () => active.current),
				),
			),
		[props.runtime, props.scope],
	);
	useLayoutEffect(() => {
		frameScope.current = props.scope;
		return () => {
			frameScope.current = undefined;
		};
	}, [props.scope]);
	useLayoutEffect(() => {
		active.current = props.active;
		props.runtime.runSync(
			Effect.map(EntityWatchService, (service) => service.refresh(props.scope)),
		);
	}, [props.active, props.runtime, props.scope]);
	const viewport = useMemo(
		() => ({ safeAreaTop: props.chrome.safeAreaTop, safeAreaBottom: props.chrome.safeAreaBottom }),
		[props.chrome.safeAreaBottom, props.chrome.safeAreaTop],
	);
	useEffect(() => {
		props.runtime.runFork(
			props.runtime.runSync(DeviceService).setFrameActive(frameKey, props.active),
		);
	}, [props.active, frameKey, props.runtime]);
	useLayoutEffect(() => {
		return () => {
			props.runtime.runFork(props.runtime.runSync(DeviceService).releaseFrame(frameKey));
		};
	}, [frameKey, props.runtime]);

	return (
		<PageIframeHost
			page={context}
			theme={props.theme}
			viewport={viewport}
			active={props.active}
			inert={props.document.inert}
			navigation={props.navigation}
			watchEntities={watchEntities}
			subscribeResume={subscribeResume}
			chromeLeading={props.edgeLeading}
			onCheckFreshness={checkFreshness}
			onReloadCurrent={props.onReloadCurrent}
			onOpenDrawer={props.chrome.onOpenDrawer}
			backInterceptors={props.backInterceptors}
			chromeTriggerRef={props.chrome.triggerRef}
			mutationCompleted={ryot.mutationCompleted}
			onNavigateBack={() => router.history.back()}
			onKernelShortcut={props.chrome.onKernelShortcut}
			icon={rendererPlugin?.icon ?? context.view?.icon}
			documentKey={documentOwner(props.document.prepared)}
			title={rendererPlugin?.name ?? props.document.title}
			freshnessCheckRevision={props.freshnessCheckRevision}
			compositionHash={props.document.prepared.composition.hash}
			onFlushReady={(handler) => {
				flush.current = handler;
			}}
			onScreenState={(state) => props.presentation.publishReadiness(props.owner, state)}
			onExternalLink={(request) => props.runtime.runSync(ExternalLinks).outcome(request)}
			onUpload={(request) => props.runtime.runSync(Uploads).outcome(props.scope, request)}
			onOverlayState={(count) => props.presentation.publishOverlayCount(props.owner, count)}
			onHeader={(publication) => props.presentation.publishHeader(props.owner, publication)}
			onAssets={(request) =>
				props.runtime.runSync(ManagedAssetsService).outcome(props.scope, request.assets)
			}
			onQuery={(request) =>
				props.runtime.runSync(PluginQueriesService).query({ request, scope: props.scope })
			}
			onReleaseResources={() => {
				props.runtime.runFork(props.runtime.runSync(DeviceService).releaseFrame(frameKey));
			}}
			onStorage={(request) =>
				props.runtime.runSync(PluginStorage).outcome(props.scope, identity.contributors, request)
			}
			onPickEntity={(request) =>
				props.document.onPickEntity?.(request) ?? Effect.succeed({ kind: "cancelled" as const })
			}
			onEditCollection={(request) =>
				props.document.onEditCollection?.(request) ?? Effect.succeed({ kind: "cancelled" as const })
			}
			onAddToCollection={(request) =>
				props.document.onAddToCollection?.(request) ??
				Effect.succeed({ kind: "cancelled" as const })
			}
			onEntitySave={(request) =>
				props.runtime
					.runSync(PluginEntitySaves)
					.outcome(props.scope, identity.contributors, request)
			}
			onRetryPopulation={(request) =>
				props.runtime
					.runSync(PluginPopulationRetries)
					.outcome(props.scope, identity.contributors, request)
			}
			onDevice={(request) =>
				props.runtime
					.runSync(DeviceService)
					.outcome(props.scope, identity.contributors, frameKey, active.current, request)
			}
			onIosLiveActivity={(request) =>
				props.runtime
					.runSync(IosLiveActivitiesService)
					.outcome(props.scope, identity.contributors, active.current, request)
			}
			onNavigate={(request) =>
				void navigate({
					href: request.href,
					replace: request.replace,
					state: (current) => ({ ...current, ryotEntryKey: crypto.randomUUID() }),
				})
			}
			onLoadDocument={() =>
				props.runtime
					.runSync(PagesApi)
					.document(props.scope, { payload: { identity } })
					.pipe(Effect.map((document) => renderClientDocument(document, props.scope.serverUrl)))
			}
			onUserSettings={(request) =>
				pluginUserSettingsOutcome({
					request,
					scope: props.scope,
					contributors: identity.contributors,
					api: props.runtime.runSync(RyotQLApi),
					currentScope: () => frameScope.current,
				})
			}
			onCalendarSourceVisibility={(request) =>
				props.runtime
					.runSync(PluginCalendarSources)
					.outcome(props.scope, identity, request)
					.pipe(
						Effect.tap((outcome) =>
							outcome.outcome === "success"
								? Effect.sync(() => ryot.mutationCompleted.hint())
								: Effect.void,
						),
					)
			}
			onPageSearch={({ mode, update }) => {
				const location = router.state.location;
				const nextSearch = mergePageSearch(location.searchStr, update);
				const href = `${location.pathname}${nextSearch === "" ? "" : `?${nextSearch}`}`;
				void navigate({
					href,
					replace: mode === "replace",
					state: (current) => ({
						...current,
						ryotEntryKey: mode === "replace" ? props.navigation.key : crypto.randomUUID(),
					}),
				});
			}}
			onInvokeOperation={(request) => {
				const target = props.operationTargets.find(
					(candidate) => candidate.packageId === request.packageId,
				);
				if (target === undefined) {
					return Effect.succeed({
						outcome: "failure" as const,
						reason: "operation-failed" as const,
					});
				}
				return props.runtime
					.runSync(PluginOperationsService)
					.invoke({ request, scope: props.scope, contentHash: target.contentHash });
			}}
			onBackgroundOperation={(request, binding) =>
				Effect.sync(() => {
					const target = resolveBackgroundSubmissionTarget(identity, catalog, request.packageId);
					const reservation =
						target === undefined
							? undefined
							: backgroundSubmissions?.reserve({ target, binding, request });
					return reservation === undefined
						? ({ outcome: "failure", reason: "operation-failed" } as const)
						: ({ reservation, outcome: "success" } as const);
				})
			}
			onCollection={(request) => {
				const operation = Effect.gen(function* () {
					if (request.action === "create") {
						const response = yield* ryot.collections.create(request.input);
						yield* Effect.tryPromise(() => router.invalidate()).pipe(Effect.ignore);
						return { response, outcome: "success" } as const;
					}
					if (request.action === "upsert-membership") {
						return {
							outcome: "success",
							response: yield* ryot.collections.upsertMembership(request.input),
						} as const;
					}
					return {
						outcome: "success",
						response: yield* ryot.collections.removeMembership(request.input),
					} as const;
				});
				return operation.pipe(
					Effect.match({
						onSuccess: (response) => response,
						onFailure: (error) =>
							({
								outcome: "failure",
								reason:
									error instanceof RyotClientError && error.reason === "collection-failed"
										? "collection-failed"
										: "transport",
							}) as const,
					}),
				);
			}}
		/>
	);
}
