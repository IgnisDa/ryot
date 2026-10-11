import type { PluginBridgeProviderSearchScreen } from "@ryot-app/client-plugin-contract";
import { Button } from "@ryot-app/client-ui-sdk";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { savedViewPath } from "@ryot-app/contract/modules/plugins/navigation";
import {
	definitionKey,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityBrowserLayout,
	EntityBrowserSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { PluginId, SavedViewId } from "@ryot-app/contract/schema/brands";
import {
	createFileRoute,
	notFound,
	useNavigate,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { Effect, Result, Schema } from "effect";
import { useEffect, useRef } from "react";

import { ClientPagesApi } from "#/api/client-pages";
import {
	useClearClientPageDocument,
	useClientPageDocument,
	useHasPublishedClientPageDocument,
} from "#/modules/client-pages/document";
import { mergePageSearch } from "#/modules/client-pages/page-host";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { effectiveCatalogPlugin } from "#/modules/plugins/plugin-location";
import { ProviderAddModal } from "#/modules/provider-add/modal";
import { ClientStorage } from "#/persistence/storage";

const validateSavedViewSearch = (search: Record<string, unknown>) => ({
	add: search.add === true || search.add === "true" ? true : undefined,
	q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
	sort: typeof search.sort === "string" && search.sort !== "" ? search.sort : undefined,
	layout: typeof search.layout === "string" && search.layout !== "" ? search.layout : undefined,
	search: typeof search.search === "string" && search.search !== "" ? search.search : undefined,
	dialog: typeof search.dialog === "string" && search.dialog !== "" ? search.dialog : undefined,
	entityId:
		typeof search.entityId === "string" && search.entityId !== "" ? search.entityId : undefined,
});

const entityBrowserSettings = (prepared: PreparedClientPage) => {
	if (prepared.context.renderer.kind !== "kernel") {
		return null;
	}
	const decoded = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(
		prepared.context.settings,
	);
	return Result.isSuccess(decoded) ? decoded.success : null;
};

export const Route = createFileRoute("/_authenticated/v/$")({
	staleTime: 30_000,
	shouldReload: true,
	component: SavedViewPage,
	errorComponent: SavedViewError,
	pendingComponent: SavedViewPending,
	loaderDeps: ({ search }) => search,
	notFoundComponent: SavedViewNotFound,
	validateSearch: validateSavedViewSearch,
	loader: ({ context, location, abortController }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const segments = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
				const plugin =
					segments[1] === "p" && segments.length === 5
						? effectiveCatalogPlugin(
								yield* Effect.flatMap(PluginCatalogService, (service) =>
									service.load(context.ryot),
								),
								`${segments[2]}/${segments[3]}`,
							)
						: undefined;
				let reference: SavedViewReference;
				let slug: string;
				if (segments[1] === "c" && segments[2] && segments.length === 3) {
					reference = { kind: "custom", savedViewId: SavedViewId.make(segments[2]) };
					slug = savedViewPath(reference);
				} else if (segments[1] === "k" && segments[2] && segments.length === 3) {
					reference = { kind: "kernel", slug: segments[2] };
					slug = savedViewPath(reference);
				} else if (plugin && segments[4]) {
					reference = {
						kind: "plugin",
						slug: segments[4],
						pluginId: PluginId.make(plugin.pluginId),
					};
					slug = savedViewPath({ kind: "plugin", slug: segments[4], packageId: plugin.packageId });
				} else {
					// oxlint-disable-next-line typescript/only-throw-error
					throw notFound();
				}
				let prepared = yield* Effect.flatMap(ClientPagesApi, (api) =>
					api.prepare(context.scope, { payload: { target: { reference, kind: "saved-view" } } }),
				);
				const settings = entityBrowserSettings(prepared);
				if (settings !== null) {
					const storedLayout = yield* Effect.flatMap(ClientStorage, (storage) =>
						storage.getSavedViewLayout(context.scope, slug),
					);
					if (settings.layouts.includes(storedLayout)) {
						prepared = {
							...prepared,
							context: {
								...prepared.context,
								settings: { ...settings, defaultLayout: storedLayout },
							},
						};
					}
				}
				return { slug, prepared };
			}),
			{ signal: abortController.signal },
		),
});

function SavedViewPage() {
	const router = useRouter();
	const navigate = useNavigate();
	const loaded = Route.useLoaderData();
	const { q, add, layout } = Route.useSearch();
	const { scope, runtime } = Route.useRouteContext();
	const location = useRouterState({
		select: (current) => current.resolvedLocation ?? current.location,
	});
	const pushedAdd = useRef(false);
	const addAction = entityBrowserSettings(loaded.prepared)?.addAction ?? null;
	const addOpen = add === true && addAction !== null;

	const navigateAddSearch = (update: Record<string, string | null>, replace: boolean) => {
		const nextSearch = mergePageSearch(location.searchStr, update);
		const href = `${location.pathname}${nextSearch === "" ? "" : `?${nextSearch}`}`;
		void navigate({ href, replace });
	};
	const openAdd = (request: PluginBridgeProviderSearchScreen) => {
		if (
			addAction === null ||
			definitionKey("entity", request.schema.owner, request.schema.slug) !==
				definitionKey("entity", addAction.schema.owner, addAction.schema.slug)
		) {
			return;
		}
		pushedAdd.current = true;
		navigateAddSearch({ add: "true", q: request.initialQuery ?? null }, false);
	};
	const closeAdd = () => {
		if (pushedAdd.current) {
			pushedAdd.current = false;
			router.history.back();
			return;
		}
		navigateAddSearch({ q: null, add: null }, true);
	};

	useEffect(() => {
		if (!addOpen) {
			pushedAdd.current = false;
		}
	}, [addOpen]);
	useEffect(() => {
		if (layout === undefined) {
			return;
		}
		const settings = entityBrowserSettings(loaded.prepared);
		const decodedLayout = Schema.decodeUnknownResult(EntityBrowserLayout)(layout);
		if (
			settings === null ||
			Result.isFailure(decodedLayout) ||
			!settings.layouts.includes(decodedLayout.success)
		) {
			return;
		}
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) =>
				storage.setSavedViewLayout(scope, loaded.slug, decodedLayout.success),
			),
		);
	}, [layout, loaded.prepared, loaded.slug, runtime, scope]);
	useClientPageDocument({
		inert: addOpen,
		prepared: loaded.prepared,
		onProviderSearch: openAdd,
		title: loaded.prepared.context.view?.name ?? "Saved view",
	});

	return addOpen ? (
		<ProviderAddModal initialQuery={q} onClose={closeAdd} schema={addAction.schema} />
	) : null;
}

function SavedViewPending() {
	return useHasPublishedClientPageDocument() ? null : (
		<SavedViewNotice title="Loading saved view" message="Loading saved view..." />
	);
}

function SavedViewNotFound() {
	return (
		<SavedViewNotice clear title="Saved view not found" message="This saved view does not exist." />
	);
}

function SavedViewError() {
	const router = useRouter();
	return (
		<SavedViewNotice
			clear
			title="Saved view unavailable"
			message="The saved view could not be loaded."
			action={<Button onClick={() => void router.invalidate()}>Retry</Button>}
		/>
	);
}

function SavedViewNotice(props: {
	readonly title: string;
	readonly message: string;
	readonly action?: React.ReactNode;
	readonly clear?: boolean;
}) {
	if (props.clear) {
		return <ClearedSavedViewNotice {...props} />;
	}
	return <SavedViewNoticeContent {...props} />;
}

function ClearedSavedViewNotice(props: Parameters<typeof SavedViewNoticeContent>[0]) {
	useClearClientPageDocument();
	return <SavedViewNoticeContent {...props} />;
}

function SavedViewNoticeContent(props: {
	readonly title: string;
	readonly message: string;
	readonly action?: React.ReactNode;
}) {
	usePageTitle(props.title);
	return (
		<main
			{...mainContentProps}
			className="grid h-full min-h-96 place-content-center px-4 text-center"
		>
			<section
				aria-labelledby="saved-view-notice-title"
				className="grid w-[min(100%,480px)] justify-items-center gap-2"
			>
				<div>
					<h1 id="saved-view-notice-title" className="text-xl font-semibold">
						{props.title}
					</h1>
					<p role="status" className="mt-1 text-sm text-text-muted">
						{props.message}
					</p>
				</div>
				{props.action}
			</section>
		</main>
	);
}
