import type { PluginBridgeProviderSearchScreen } from "@ryot-app/client-plugin-contract";
import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import {
	EntityBrowserAddAction,
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
import { SavedViewsService } from "#/modules/saved-views/service";
import { ClientStorage } from "#/persistence/storage";

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
		const record = await context.runtime.runPromise(
			Effect.flatMap(SavedViewsService, (service) => service.loadRecord(context.ryot, slug)),
			{ signal: abortController.signal },
		);
		if (record === undefined) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		let prepared = await context.runtime.runPromise(
			Effect.flatMap(ClientPagesApi, (api) =>
				api.prepare(context.scope, {
					payload: { target: { kind: "saved-view", savedViewId: record.id } },
				}),
			),
			{ signal: abortController.signal },
		);
		if (record.renderer.kind === "kernel" && record.renderer.name === "entity-browser") {
			const settings = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(record.settings);
			if (Result.isSuccess(settings)) {
				const storedLayout = await context.runtime.runPromise(
					Effect.flatMap(ClientStorage, (storage) =>
						storage.getSavedViewLayout(context.scope, record.slug),
					),
					{ signal: abortController.signal },
				);
				if (settings.success.layouts.includes(storedLayout)) {
					prepared = {
						...prepared,
						context: {
							...prepared.context,
							settings: { ...settings.success, defaultLayout: storedLayout },
						},
					};
				}
			}
		}
		return { record, prepared };
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
	const decodedAction = Schema.decodeUnknownResult(EntityBrowserAddAction)(
		loaded.record.renderer.kind === "kernel" && loaded.record.renderer.name === "entity-browser"
			? loaded.record.settings.addAction
			: undefined,
	);
	const addAction = Result.isSuccess(decodedAction) ? decodedAction.success : null;
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
		if (
			layout === undefined ||
			loaded.record.renderer.kind !== "kernel" ||
			loaded.record.renderer.name !== "entity-browser"
		) {
			return;
		}
		const settings = Schema.decodeUnknownResult(EntityBrowserSavedViewSettings)(
			loaded.record.settings,
		);
		const decodedLayout = Schema.decodeUnknownResult(EntityBrowserLayout)(layout);
		if (
			Result.isFailure(settings) ||
			Result.isFailure(decodedLayout) ||
			!settings.success.layouts.includes(decodedLayout.success)
		) {
			return;
		}
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) =>
				storage.setSavedViewLayout(scope, loaded.record.slug, decodedLayout.success),
			),
		);
	}, [layout, loaded.record, runtime, scope]);
	useClientPageDocument({
		inert: addOpen,
		prepared: loaded.prepared,
		title: loaded.record.name,
		onProviderSearch: openAdd,
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
