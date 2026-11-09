import type {
	PublicationUnavailableCode,
	PublicationVisitorPage,
} from "@ryot-app/contract/modules/publications/schemas";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

import { browserServerOrigin } from "#/api/origin";
import { isPublicationVisitFailure, PublicationVisitsApi } from "#/api/publications";
import { classifyRyotQLCause } from "#/api/ryotql";
import {
	classifyManagedAssetCause,
	mapManagedAssetResolutions,
} from "#/modules/assets/managed-assets";
import { ExternalLinks } from "#/modules/external-links/service";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { historyEntry } from "#/modules/navigation/history-entry";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { renderClientDocument } from "#/modules/pages/documents/srcdoc";
import { navigatePageSearch } from "#/modules/pages/runtime/document-host";
import { PageIframeHost } from "#/modules/pages/runtime/iframe-host";
import { useIsDesktop } from "#/modules/shell/breakpoint";
import { useSafeAreaInsets } from "#/modules/shell/safe-area";
import type { ThemeStore } from "#/modules/theme/store";
import { StatusState } from "#/modules/ui/status-state";
import type { ClientRuntime } from "#/runtime";

import {
	makeVisitSession,
	takeVisitCredentials,
	unavailableCode,
	type VisitCredentials,
	type VisitSession,
} from "./visit-session";

type VisitState =
	| { readonly kind: "failed" }
	| { readonly kind: "loading" }
	| { readonly kind: "unavailable"; readonly code: PublicationUnavailableCode }
	| {
			readonly kind: "ready";
			readonly session: VisitSession;
			readonly page: PublicationVisitorPage;
	  };

const unavailableCopy: Record<PublicationUnavailableCode, { title: string; detail: string }> = {
	revoked: { title: "Link revoked", detail: "The owner stopped sharing this page." },
	disabled: { title: "Sharing disabled", detail: "This server does not allow shared pages." },
	"not-found": { title: "Link not found", detail: "This link is incomplete or does not exist." },
	expired: { title: "Link expired", detail: "This link has expired. Ask the owner for a new one." },
	unavailable: {
		title: "Page unavailable",
		detail: "This shared page is not available right now.",
	},
	"too-large": {
		title: "Page unavailable",
		detail: "This page shares more items than this server allows.",
	},
	"session-expired": {
		title: "Link needed",
		detail: "Open the full link you were given to view this page again.",
	},
};

const refused = <A,>(value: A) => Effect.succeed(value);

export function PublicationVisit(props: {
	readonly theme: ThemeStore;
	readonly publicationId: string;
	readonly runtime: ClientRuntime;
	readonly backInterceptors: BackInterceptors;
}) {
	const [attempt, setAttempt] = useState(0);
	const [credentials] = useState(() => {
		const taken = takeVisitCredentials(props.publicationId, window.location.hash);
		if (window.location.hash !== "") {
			window.history.replaceState(
				window.history.state,
				"",
				`${window.location.pathname}${window.location.search}`,
			);
		}
		return taken;
	});
	return (
		<PublicationVisitAttempt
			{...props}
			key={attempt}
			credentials={credentials}
			onReload={() => setAttempt((current) => current + 1)}
		/>
	);
}

function PreviewBanner() {
	const router = useRouter();
	const navigate = useNavigate();
	return (
		<div
			role="status"
			className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2"
		>
			<span className="flex items-center gap-2 text-xs font-medium text-text">
				<AppIcon size={14} name="eye" className="text-text-muted" />
				Previewing as a visitor
			</span>
			<Button
				size="sm"
				variant="ghost"
				onClick={() => {
					if (router.history.canGoBack()) {
						router.history.back();
						return;
					}
					void navigate({ to: "/settings/publications" });
				}}
			>
				Exit preview
			</Button>
		</div>
	);
}

function PublicationVisitAttempt(props: {
	readonly theme: ThemeStore;
	readonly onReload: () => void;
	readonly publicationId: string;
	readonly runtime: ClientRuntime;
	readonly credentials: VisitCredentials;
	readonly backInterceptors: BackInterceptors;
}) {
	const { runtime, credentials, publicationId } = props;
	const [state, setState] = useState<VisitState>({ kind: "loading" });
	usePageTitle(state.kind === "ready" ? state.page.publication.title : "Shared page");

	useEffect(() => {
		const fiber = runtime.runFork(
			Effect.gen(function* () {
				const api = yield* PublicationVisitsApi;
				const origin = yield* browserServerOrigin;
				const session = makeVisitSession({ api, origin, credentials, publicationId });
				return { session, page: yield* session.run((scope) => api.page(scope)) };
			}).pipe(
				Effect.match({
					onSuccess: ({ page, session }) => setState({ page, session, kind: "ready" }),
					onFailure: (error) => {
						const code = unavailableCode(error);
						setState(code === null ? { kind: "failed" } : { code, kind: "unavailable" });
					},
				}),
			),
		);
		return () => {
			fiber.interruptUnsafe();
		};
	}, [credentials, publicationId, runtime]);

	if (state.kind === "loading") {
		return (
			<main {...mainContentProps} className="ui-page">
				<StatusState className="py-16" detail="Opening shared page..." />
			</main>
		);
	}
	if (state.kind !== "ready") {
		const copy =
			state.kind === "unavailable"
				? unavailableCopy[state.code]
				: { title: "Page unavailable", detail: "The shared page could not be loaded." };
		return (
			<main {...mainContentProps} className="ui-page">
				<StatusState className="py-16" title={copy.title} detail={copy.detail} />
			</main>
		);
	}

	return (
		<main {...mainContentProps} className="flex h-dvh flex-col bg-bg">
			{credentials.secret === null && <PreviewBanner />}
			<div className="min-h-0 flex-1">
				<PublicationFrame
					page={state.page}
					runtime={runtime}
					theme={props.theme}
					session={state.session}
					onReload={props.onReload}
					backInterceptors={props.backInterceptors}
				/>
			</div>
		</main>
	);
}

const ITEM_SEARCH_KEY = "item";

function PublicationFrame(props: {
	readonly theme: ThemeStore;
	readonly onReload: () => void;
	readonly session: VisitSession;
	readonly runtime: ClientRuntime;
	readonly page: PublicationVisitorPage;
	readonly backInterceptors: BackInterceptors;
}) {
	const desktop = useIsDesktop();
	const insets = useSafeAreaInsets();
	const chromeTriggerRef = useRef<HTMLElement>(null);
	const router = useRouter();
	const navigate = useNavigate();
	const location = useRouterState({ select: (current) => current.location });
	const entry = useMemo(() => historyEntry(location.state), [location.state]);
	const search = location.searchStr.replace(/^\?/, "");
	const item = new URLSearchParams(search).get(ITEM_SEARCH_KEY);
	const navigateSearch = (update: Record<string, null | string>, replace: boolean) =>
		navigatePageSearch(navigate, { update, replace, location, entryKey: entry.key });
	const api = props.runtime.runSync(PublicationVisitsApi);
	const { page, session } = props;
	const context: ClientPageContext = page.context;
	const navigation = useMemo(
		() => ({
			...entry,
			compact: !desktop,
			edgeBack: item !== null,
			location: { search, path: "/", kind: "route" as const },
			leading: item === null ? ("none" as const) : ("back" as const),
		}),
		[desktop, entry, item, search],
	);
	const mutationCompleted = useMemo(
		() => ({ hint: () => undefined, subscribe: () => () => undefined }),
		[],
	);
	return (
		<PageIframeHost
			active
			page={context}
			viewport={insets}
			theme={props.theme}
			chromeLeading={null}
			navigation={navigation}
			freshnessCheckRevision={0}
			onHeader={() => undefined}
			icon={page.publication.icon}
			title={page.publication.title}
			onOpenDrawer={() => undefined}
			onFlushReady={() => undefined}
			onScreenState={() => undefined}
			onReloadCurrent={props.onReload}
			onOverlayState={() => undefined}
			onKernelShortcut={() => undefined}
			chromeTriggerRef={chromeTriggerRef}
			onReleaseResources={() => undefined}
			mutationCompleted={mutationCompleted}
			compositionHash={page.composition.hash}
			backInterceptors={props.backInterceptors}
			onCheckFreshness={() => Effect.succeed(true)}
			onPickEntity={() => refused({ kind: "cancelled" as const })}
			onSharePublication={() => refused({ kind: "closed" as const })}
			onEditCollection={() => refused({ kind: "cancelled" as const })}
			onAddToCollection={() => refused({ kind: "cancelled" as const })}
			onManageReminders={() => refused({ kind: "cancelled" as const })}
			watchEntities={() => ({ update: () => undefined, dispose: () => undefined })}
			onPageSearch={({ mode, update }) => navigateSearch(update, mode === "replace")}
			onExternalLink={(request) => props.runtime.runSync(ExternalLinks).outcome(request)}
			onDevice={() => refused({ outcome: "failure", reason: "invalid-request" } as const)}
			onUpload={() => refused({ outcome: "failure", reason: "operation-failed" } as const)}
			onStorage={() => refused({ outcome: "failure", reason: "invalid-request" } as const)}
			onEntitySave={() => refused({ outcome: "failure", reason: "invalid-request" } as const)}
			onEnrichment={() => refused({ outcome: "failure", reason: "invalid-request" } as const)}
			documentKey={`publication:${page.publication.publicationId}:${page.publication.revision}`}
			onUserSettings={() => refused({ outcome: "failure", reason: "invalid-request" } as const)}
			onCollection={() => refused({ outcome: "failure", reason: "collection-failed" } as const)}
			onIosLiveActivity={() => refused({ outcome: "failure", reason: "invalid-request" } as const)}
			onInvokeOperation={() => refused({ outcome: "failure", reason: "operation-failed" } as const)}
			onBackgroundOperation={() =>
				refused({ outcome: "failure", reason: "operation-failed" } as const)
			}
			onReportingPreferences={() =>
				refused({ outcome: "failure", reason: "invalid-request" } as const)
			}
			onCalendarSourceVisibility={() =>
				refused({ outcome: "failure", reason: "invalid-request" } as const)
			}
			onNavigate={({ mode, target }) => {
				if (target.kind === "entity") {
					navigateSearch({ [ITEM_SEARCH_KEY]: target.entityId }, mode === "replace");
				}
			}}
			onNavigateBack={() => {
				if (item !== null && router.history.canGoBack()) {
					router.history.back();
					return;
				}
				navigateSearch({ [ITEM_SEARCH_KEY]: null }, true);
			}}
			onLoadDocument={() =>
				session
					.run((scope) =>
						api.document(scope, { payload: { compositionHash: page.composition.hash } }),
					)
					.pipe(Effect.map((document) => renderClientDocument(document, session.origin)))
			}
			onQuery={(request) =>
				session
					.run((scope) => api.ryotql(scope, { payload: request.document }))
					.pipe(
						Effect.match({
							onSuccess: (response) => ({ response, outcome: "success" }) as const,
							onFailure: (error) =>
								({
									outcome: "failure",
									reason: classifyRyotQLCause(error.cause, isPublicationVisitFailure),
								}) as const,
						}),
					)
			}
			onAssets={(request) =>
				session
					.run((scope) => api.assets(scope, { payload: { assets: [...request.assets] } }))
					.pipe(
						Effect.match({
							onSuccess: (response) =>
								({
									outcome: "success",
									resolutions: mapManagedAssetResolutions(session.origin, response),
								}) as const,
							onFailure: (error) =>
								({
									outcome: "failure",
									reason: classifyManagedAssetCause(error.cause, isPublicationVisitFailure),
								}) as const,
						}),
					)
			}
		/>
	);
}
