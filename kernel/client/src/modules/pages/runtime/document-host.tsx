import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { useRouteContext, useRouter, useRouterState } from "@tanstack/react-router";
import { Effect, Match, Schema } from "effect";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";

import { historyEntry } from "#/modules/navigation/history-entry";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import type { PluginBridgeNavigationState } from "#/modules/pages/bridge/session";
import {
	type ClientPageDocument,
	usePublishedClientPageDocument,
} from "#/modules/pages/documents/state";
import { toPluginLocation } from "#/modules/plugins/catalog/location";
import { usePluginCatalog } from "#/modules/plugins/catalog/provider";
import { useScreenLeadingControl } from "#/modules/shell/app-screen";
import {
	useClientPagePresentation,
	useEdge,
	usePluginTitle,
	useShellChrome,
} from "#/modules/shell/authenticated-shell-context";
import type { FileRoutesById } from "#/routeTree.gen";

import { documentOwner } from "./document-key";
import { PageDocumentHost } from "./page-document-host";

const MAX_RETAINED_FRAMES = 3;
class DocumentReloadError extends Schema.TaggedError<
	DocumentReloadError,
	{ readonly brand: unique symbol }
>()("DocumentReloadError", { cause: Schema.Unknown }) {}

const pluginRouteIds = new Set<string>([
	"/_authenticated/page-preview/$pageId",
	"/_authenticated/p/$publisher/$name",
	"/_authenticated/e/$entityId",
	"/_authenticated/v/c/$savedViewId",
	"/_authenticated/v/k/$slug",
	"/_authenticated/v/p/$publisher/$name/$slug",
] satisfies ReadonlyArray<keyof FileRoutesById>);
const searchString = (value: string) => (value.startsWith("?") ? value.slice(1) : value);

type FramePool = {
	readonly activeKey: null | string;
	readonly entries: ReadonlyMap<string, FrameEntry>;
};

type FrameEntry = {
	readonly key: string;
	readonly generation: number;
	readonly compositionHash: string;
	readonly document: ClientPageDocument;
	readonly navigation: PluginBridgeNavigationState;
	readonly location: { readonly pathname: string; readonly searchStr: string };
	readonly operationTargets: PreparedClientPage["identity"]["operationTargets"];
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
		readonly previousDocument: null | ClientPageDocument;
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
						Match.when({ kind: "page-preview" }, () => ({
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
	const navigation = useMemo<undefined | PluginBridgeNavigationState>(
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
		readonly pathname: string;
		readonly searchStr: string;
		readonly document: null | ClientPageDocument;
		readonly navigation: undefined | PluginBridgeNavigationState;
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
				Effect.tryPromise({
					try: () => router.invalidate(),
					catch: (cause) => new DocumentReloadError({ cause }),
				}).pipe(
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
						<PageDocumentHost
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
