import type { PluginBridgeProviderSearchScreen } from "@ryot-app/client-plugin-contract";
import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import {
	EntityBrowserLayout,
	EntityBrowserSavedViewSettings,
} from "@ryot-app/contract/modules/saved-views/schemas";
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
import { ProviderAddModal } from "#/modules/provider-add/modal";
import { ClientStorage } from "#/persistence/storage";

const entityBrowserSettings = (prepared: PreparedClientPage) => {
	if (prepared.context.renderer.kind !== "kernel") {
		return null;
	}
	const decoded = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(
		prepared.context.settings,
	);
	return Result.isSuccess(decoded) ? decoded.success : null;
};

export const Route = createFileRoute("/_authenticated/v/$viewSlug")({
	staleTime: 30_000,
	component: SavedViewPage,
	errorComponent: SavedViewError,
	pendingComponent: SavedViewPending,
	notFoundComponent: SavedViewNotFound,
	validateSearch: (search) => ({
		add: search.add === true || search.add === "true" ? true : undefined,
		q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
		sort: typeof search.sort === "string" && search.sort !== "" ? search.sort : undefined,
		layout: typeof search.layout === "string" && search.layout !== "" ? search.layout : undefined,
		search: typeof search.search === "string" && search.search !== "" ? search.search : undefined,
		dialog: typeof search.dialog === "string" && search.dialog !== "" ? search.dialog : undefined,
		entityId:
			typeof search.entityId === "string" && search.entityId !== "" ? search.entityId : undefined,
	}),
	loader: async ({ params, context, abortController }) => {
		const slug = params.viewSlug.trim();
		if (slug.length === 0) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		let prepared = await context.runtime.runPromise(
			Effect.flatMap(ClientPagesApi, (api) =>
				api.prepare(context.scope, { payload: { target: { slug, kind: "saved-view" } } }),
			),
			{ signal: abortController.signal },
		);
		const settings = entityBrowserSettings(prepared);
		if (settings !== null) {
			const storedLayout = await context.runtime.runPromise(
				Effect.flatMap(ClientStorage, (storage) => storage.getSavedViewLayout(context.scope, slug)),
				{ signal: abortController.signal },
			);
			if (settings.layouts.includes(storedLayout)) {
				prepared = {
					...prepared,
					context: { ...prepared.context, settings: { ...settings, defaultLayout: storedLayout } },
				};
			}
		}
		return { slug, prepared };
	},
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
	const imported = useRef(false);
	const pushedAdd = useRef(false);
	const ryot = useRyot();
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
			request.ownerPluginId !== addAction.ownerPluginId ||
			request.entitySchemaSlug !== addAction.entitySchemaSlug
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
		if (addOpen) {
			return;
		}
		pushedAdd.current = false;
		if (!imported.current) {
			return;
		}
		imported.current = false;
		ryot.mutationCompleted.hint();
	}, [addOpen, ryot]);
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
		<ProviderAddModal
			initialQuery={q}
			onClose={closeAdd}
			ownerPluginId={addAction.ownerPluginId}
			entitySchemaSlug={addAction.entitySchemaSlug}
			onImported={() => {
				imported.current = true;
			}}
		/>
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
