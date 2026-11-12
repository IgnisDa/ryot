import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type {
	ChangeCollectionMembersOutcome,
	ManageCollectionReviewsOutcome,
	ManageRemindersOutcome,
} from "@ryot-app/plugin-client-contract";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { useRyot } from "@ryot-app/plugin-client-sdk/react";
import { useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

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
import { PluginCalendarSources } from "#/modules/pages/bridge/calendar-sources";
import { PluginEnrichment } from "#/modules/pages/bridge/enrichment";
import { PluginEntitySaves } from "#/modules/pages/bridge/entity-saves";
import { PluginOperationsService } from "#/modules/pages/bridge/operations";
import { PluginQueriesService } from "#/modules/pages/bridge/queries";
import type { PluginBridgeNavigationState } from "#/modules/pages/bridge/session";
import { PluginStorage } from "#/modules/pages/bridge/storage";
import {
	pluginUserSettingsOutcome,
	userPreferencesOutcome,
} from "#/modules/pages/bridge/user-settings";
import { renderClientDocument } from "#/modules/pages/documents/srcdoc";
import type { ClientPageDocument } from "#/modules/pages/documents/state";
import { ClientPageFreshness } from "#/modules/pages/preparation/freshness";
import { PageIframeHost } from "#/modules/pages/runtime/iframe-host";
import { toNavigationRequest } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import type {
	ClientPagePresentationController,
	ShellChrome,
} from "#/modules/shell/authenticated-shell-context";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

import { documentOwner } from "./document-key";
import { navigatePageSearch } from "./page-search";

export function PageDocumentHost(props: {
	readonly owner: string;
	readonly active: boolean;
	readonly scope: ApiScope;
	readonly theme: ThemeStore;
	readonly embedded?: boolean;
	readonly chrome: ShellChrome;
	readonly runtime: ClientRuntime;
	readonly edgeLeading: ReactNode;
	readonly onReloadCurrent: () => void;
	readonly document: ClientPageDocument;
	readonly freshnessCheckRevision: number;
	readonly backInterceptors: BackInterceptors;
	readonly navigation: PluginBridgeNavigationState;
	readonly presentation: ClientPagePresentationController;
	readonly operationTargets: PreparedClientPage["identity"]["operationTargets"];
}) {
	const ryot = useRyot();
	const router = useRouter();
	const navigate = useNavigate();
	const active = useRef(props.active);
	const frameScope = useRef<ApiScope | undefined>(props.scope);
	const frameKey = `${props.owner}:${props.navigation.key}`;
	const flush = useRef<undefined | (() => Effect.Effect<boolean>)>(undefined);
	useBlocker({
		enableBeforeUnload: false,
		shouldBlockFn: () =>
			props.embedded !== true && flush.current !== undefined
				? props.runtime.runPromise(flush.current().pipe(Effect.map((flushed) => !flushed)))
				: false,
	});
	const { catalog } = usePluginCatalog();
	const backgroundSubmissions = useBackgroundSubmissionTray();
	const { context, identity } = props.document.prepared;
	const renderer = context.renderer;
	const pageAuthority =
		renderer.kind === "page"
			? {
					pageId: renderer.pageId,
					revision: renderer.revision,
					definitionHash: renderer.definitionHash,
					authorityRevision: renderer.authorityRevision,
				}
			: undefined;
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
			embedded={props.embedded}
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
			onNavigateBack={() => {
				if (!props.embedded) {
					router.history.back();
				}
			}}
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
			onEnrichment={(request) =>
				props.runtime.runSync(PluginEnrichment).outcome(props.scope, identity.contributors, request)
			}
			onEditCollection={(request) =>
				props.document.onEditCollection?.(request) ?? Effect.succeed({ kind: "cancelled" as const })
			}
			onSharePublication={(request) =>
				props.document.onSharePublication?.(request) ?? Effect.succeed({ kind: "closed" as const })
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
			onManageReminders={(request) =>
				props.document.onManageReminders?.(request) ??
				Effect.succeed<ManageRemindersOutcome>({ kind: "cancelled" })
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
			onManageCollectionReviews={(request) =>
				props.document.onManageCollectionReviews?.(request) ??
				Effect.succeed<ManageCollectionReviewsOutcome>({ kind: "cancelled" })
			}
			onChangeCollectionMembers={(request) =>
				props.document.onChangeCollectionMembers?.(request) ??
				Effect.succeed<ChangeCollectionMembersOutcome>({ kind: "cancelled" })
			}
			onUserPreferences={() =>
				userPreferencesOutcome({
					scope: props.scope,
					api: props.runtime.runSync(RyotQLApi),
					currentScope: () => frameScope.current,
				})
			}
			onLoadDocument={() =>
				props.runtime
					.runSync(PagesApi)
					.document(props.scope, { payload: { identity } })
					.pipe(Effect.map((document) => renderClientDocument(document, props.scope.serverUrl)))
			}
			onPageSearch={({ mode, update }) =>
				!props.embedded &&
				navigatePageSearch(navigate, {
					update,
					replace: mode === "replace",
					entryKey: props.navigation.key,
					location: router.state.location,
				})
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
			onNavigate={(request) => {
				const navigation = toNavigationRequest(request, catalog);
				if (!props.embedded && navigation !== undefined) {
					void navigate({
						href: navigation.href,
						replace: navigation.replace,
						state: (current) => ({ ...current, ryotEntryKey: crypto.randomUUID() }),
					});
				}
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
					.invoke({
						request,
						scope: props.scope,
						contentHash: target.contentHash,
						...(pageAuthority === undefined ? {} : { pageAuthority }),
					});
			}}
			onBackgroundOperation={(request, binding) =>
				Effect.sync(() => {
					const target = resolveBackgroundSubmissionTarget(identity, catalog, request.packageId);
					const reservation =
						target === undefined
							? undefined
							: backgroundSubmissions?.reserve({
									binding,
									request,
									target: { ...target, ...(pageAuthority === undefined ? {} : { pageAuthority }) },
								});
					return reservation === undefined
						? ({ outcome: "failure", reason: "operation-failed" } as const)
						: ({ reservation, outcome: "success" } as const);
				})
			}
			onCollection={(request) => {
				const operation = Effect.gen(function* () {
					if (request.action === "create") {
						const response = yield* ryot.collections.create(request.input);
						yield* Effect.promise(() => router.invalidate()).pipe(Effect.ignoreCause);
						return { response, outcome: "success" } as const;
					}
					if (request.action === "upsert-membership") {
						return {
							outcome: "success",
							response: yield* ryot.collections.upsertMembership(request.input),
						} as const;
					}
					if (request.action === "remove-membership") {
						return {
							outcome: "success",
							response: yield* ryot.collections.removeMembership(request.input),
						} as const;
					}
					return {
						outcome: "success",
						response: yield* ryot.collections.reorderMembership(request.input),
					} as const;
				});
				return operation.pipe(
					Effect.match({
						onSuccess: (response) => response,
						onFailure: (error) =>
							({
								outcome: "failure",
								reason:
									error instanceof RyotClientError &&
									(error.reason === "collection-failed" || error.reason === "collection-stale")
										? error.reason
										: "transport",
							}) as const,
					}),
				);
			}}
		/>
	);
}
