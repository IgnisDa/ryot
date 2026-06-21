import { RyotClientError } from "@ryot-app/client-sdk";
import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import type { SavedViewLayoutName } from "@ryot-app/contract/modules/saved-views/schemas";
import type {
	SavedViewCardResultItem,
	SavedViewTableResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { Effect } from "effect";
import {
	type SyntheticEvent,
	type ReactNode,
	useEffect,
	useEffectEvent,
	useReducer,
	useRef,
	useState,
} from "react";

import { collectManagedAssets, ManagedAssetsService } from "#/modules/assets/managed-assets";
import { AppIcon } from "#/modules/navigation/app-icon";
import {
	appendSavedViewPage,
	createSavedViewController,
	savedViewControllerReducer,
	type SavedViewData,
	type SavedViewItem,
	type SavedViewRequestToken,
} from "#/modules/saved-views/controller";
import { SavedViewGrid } from "#/modules/saved-views/grid";
import { SavedViewList } from "#/modules/saved-views/list";
import {
	normalizeSavedViewSearch,
	savedViewQueryIdentity,
	withSavedViewCursor,
	withSavedViewSearch,
} from "#/modules/saved-views/query";
import { SavedViewLoadError, SavedViewsService } from "#/modules/saved-views/service";
import { SavedViewTable } from "#/modules/saved-views/table";
import { ClientStorage } from "#/persistence/storage";

export const Route = createFileRoute("/_authenticated/v/$viewSlug")({
	component: SavedViewPage,
	errorComponent: SavedViewError,
	pendingComponent: SavedViewPending,
	notFoundComponent: SavedViewNotFound,
	loader: async ({ abortController, context, params, parentMatchPromise }) => {
		const slug = params.viewSlug.trim();
		if (slug.length === 0) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const parentMatch = await parentMatchPromise;
		const parentData = parentMatch.loaderData;
		if (parentData === undefined) {
			throw new SavedViewLoadError({
				stage: "record",
				cause: new Error("Authenticated route data is unavailable"),
			});
		}
		const record = await context.runtime.runPromise(
			Effect.flatMap(SavedViewsService, (service) => service.loadRecord(parentData.ryot, slug)),
			{ signal: abortController.signal },
		);
		if (record === undefined) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const layout = await context.runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) => storage.getSavedViewLayout(context.scope, slug)),
			{ signal: abortController.signal },
		);
		const definition = record.layouts[layout];
		const page = await context.runtime.runPromise(
			Effect.flatMap(SavedViewsService, (service) =>
				service.loadPage(parentData.ryot, layout, definition, definition.queryDocument),
			),
			{ signal: abortController.signal },
		);
		const managedUrls = await context.runtime.runPromise(
			Effect.flatMap(ManagedAssetsService, (service) =>
				service.resolve(context.scope, collectManagedAssets(page.items.map((item) => item.image))),
			).pipe(Effect.catch(() => Effect.succeed(new Map<string, string>()))),
			{ signal: abortController.signal },
		);
		return {
			layout,
			record,
			data: appendSavedViewPage(undefined, page, definition.queryDocument, managedUrls),
		};
	},
});

type CountState =
	| { readonly key: string; readonly status: "idle" | "counting" | "failed" }
	| { readonly key: string; readonly status: "resolved"; readonly total: number };

type PageRequest = {
	readonly controller: AbortController;
	readonly token: SavedViewRequestToken;
};

function SavedViewPage() {
	const { data, layout, record } = Route.useLoaderData();
	return (
		<SavedViewContent
			data={data}
			record={record}
			layout={layout}
			key={`${record.id}:${record.updatedAt}`}
		/>
	);
}

function SavedViewContent(props: {
	readonly data: SavedViewData;
	readonly layout: SavedViewLayoutName;
	readonly record: ReturnType<typeof Route.useLoaderData>["record"];
}) {
	const ryot = useRyot();
	const { runtime, scope } = Route.useRouteContext();
	const initialIdentity = savedViewQueryIdentity(props.record, "");
	const [search, setSearch] = useState("");
	const [committedSearch, setCommittedSearch] = useState("");
	const [count, setCount] = useState<CountState>({ key: "", status: "idle" });
	const [state, dispatch] = useReducer(
		savedViewControllerReducer,
		createSavedViewController({
			data: props.data,
			layout: props.layout,
			identity: initialIdentity,
		}),
	);
	const stateRef = useRef(state);
	const requestedIdentity = useRef(initialIdentity);
	const countRequest = useRef<
		{ readonly key: string; readonly controller: AbortController } | undefined
	>(undefined);
	const pageRequest = useRef<PageRequest | undefined>(undefined);
	stateRef.current = state;

	const runPageRequest = useEffectEvent(
		async (input: {
			readonly identity: string;
			readonly layout: SavedViewLayoutName;
			readonly phase: "initial" | "load-more";
			readonly current?: SavedViewData | undefined;
			readonly queryDocument: (typeof props.record.layouts)[SavedViewLayoutName]["queryDocument"];
		}) => {
			pageRequest.current?.controller.abort();
			const controller = new AbortController();
			const token = {
				layout: input.layout,
				identity: input.identity,
				generation: stateRef.current.generation + 1,
			};
			const request = { controller, token };
			pageRequest.current = request;
			dispatch({ type: "request-started", operation: { token, phase: input.phase } });
			try {
				let requestDocument = input.queryDocument;
				if (input.phase === "load-more") {
					const cursor = input.current?.pageInfo.nextCursor;
					if (cursor === null || cursor === undefined) {
						throw new TypeError("Saved-view page has more results without a cursor");
					}
					requestDocument = withSavedViewCursor(input.queryDocument, cursor);
				}
				const definition = props.record.layouts[input.layout];
				const page = await runtime.runPromise(
					Effect.flatMap(SavedViewsService, (service) =>
						service.loadPage(ryot, input.layout, definition, requestDocument),
					),
					{ signal: controller.signal },
				);
				const unresolved = appendSavedViewPage(
					input.current,
					page,
					input.queryDocument,
					input.current?.managedUrls ?? new Map(),
				);
				const assets = collectManagedAssets(unresolved.items.map((item) => item.image));
				const managedUrls = await runtime.runPromise(
					Effect.flatMap(ManagedAssetsService, (service) => service.resolve(scope, assets)).pipe(
						Effect.catch(() => Effect.succeed(input.current?.managedUrls ?? new Map())),
					),
					{ signal: controller.signal },
				);
				if (pageRequest.current !== request) {
					return;
				}
				pageRequest.current = undefined;
				dispatch({
					token,
					type: "request-succeeded",
					data: { ...unresolved, managedUrls },
				});
			} catch (cause) {
				if (pageRequest.current !== request || controller.signal.aborted) {
					return;
				}
				pageRequest.current = undefined;
				dispatch({ cause, token, type: "request-failed" });
			}
		},
	);

	useEffect(() => {
		const timer = setTimeout(() => setCommittedSearch(normalizeSavedViewSearch(search)), 300);
		return () => clearTimeout(timer);
	}, [search]);

	useEffect(() => {
		const identity = savedViewQueryIdentity(props.record, committedSearch);
		if (requestedIdentity.current === identity) {
			return;
		}
		requestedIdentity.current = identity;
		const current = stateRef.current;
		const definition = props.record.layouts[current.activeLayout];
		const queryDocument = withSavedViewSearch(
			definition.queryDocument,
			definition,
			committedSearch,
		);
		dispatch({ identity, type: "identity-changed" });
		void runPageRequest({
			identity,
			queryDocument,
			phase: "initial",
			layout: current.activeLayout,
		});
	}, [committedSearch, props.record]);

	useEffect(
		() => () => {
			pageRequest.current?.controller.abort();
			countRequest.current?.controller.abort();
		},
		[],
	);

	const selectLayout = (nextLayout: SavedViewLayoutName) => {
		const current = stateRef.current;
		if (nextLayout === current.activeLayout) {
			return;
		}
		pageRequest.current?.controller.abort();
		pageRequest.current = undefined;
		dispatch({ layout: nextLayout, type: "layout-changed" });
		void runtime.runPromise(
			Effect.flatMap(ClientStorage, (storage) =>
				storage.setSavedViewLayout(scope, props.record.slug, nextLayout),
			),
		);
		if (current.layouts[nextLayout] === undefined) {
			const definition = props.record.layouts[nextLayout];
			void runPageRequest({
				phase: "initial",
				layout: nextLayout,
				identity: current.identity,
				queryDocument: withSavedViewSearch(definition.queryDocument, definition, committedSearch),
			});
		}
	};

	const loadMore = () => {
		const currentState = stateRef.current;
		const current = currentState.layouts[currentState.activeLayout];
		if (
			current === undefined ||
			currentState.operation !== undefined ||
			!current.pageInfo.hasMore
		) {
			return;
		}
		void runPageRequest({
			current,
			phase: "load-more",
			identity: currentState.identity,
			layout: currentState.activeLayout,
			queryDocument: current.queryDocument,
		});
	};
	const retryPage = () => {
		const current = stateRef.current;
		if (current.failedPhase === "load-more") {
			loadMore();
			return;
		}
		const definition = props.record.layouts[current.activeLayout];
		void runPageRequest({
			phase: "initial",
			identity: current.identity,
			layout: current.activeLayout,
			queryDocument: withSavedViewSearch(definition.queryDocument, definition, committedSearch),
		});
	};

	const visible = state.visible;
	const countKey =
		visible === undefined
			? ""
			: JSON.stringify([visible.identity, visible.layout, visible.data.queryDocument]);
	const currentCount = count.key === countKey ? count : { key: countKey, status: "idle" as const };
	const countAll = useEffectEvent(async () => {
		if (
			visible === undefined ||
			currentCount.status === "counting" ||
			currentCount.status === "resolved"
		) {
			return;
		}
		countRequest.current?.controller.abort();
		const controller = new AbortController();
		const request = { controller, key: countKey };
		countRequest.current = request;
		setCount({ key: countKey, status: "counting" });
		try {
			const definition = props.record.layouts[visible.layout];
			const total = await runtime.runPromise(
				Effect.flatMap(SavedViewsService, (service) =>
					service.count(ryot, visible.data.queryDocument, definition.entityIdField),
				),
				{ signal: controller.signal },
			);
			if (countRequest.current === request) {
				countRequest.current = undefined;
				setCount({ key: countKey, status: "resolved", total });
			}
		} catch {
			if (countRequest.current === request && !controller.signal.aborted) {
				countRequest.current = undefined;
				setCount({ key: countKey, status: "failed" });
			}
		}
	});

	const transitioning =
		visible !== undefined &&
		(visible.identity !== state.identity || visible.layout !== state.activeLayout);
	const submitSearch = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		setCommittedSearch(normalizeSavedViewSearch(search));
	};
	const data = visible?.data;
	const resultCount = data
		? savedViewResultLabel(data.items.length, data.pageInfo.hasMore, currentCount)
		: "";
	let countActionLabel = "Count all";
	if (currentCount.status === "counting") {
		countActionLabel = "Counting...";
	} else if (currentCount.status === "failed") {
		countActionLabel = "Retry count";
	}
	let content: ReactNode;
	if (data === undefined) {
		content = <SavedViewInlineError onRetry={retryPage} />;
	} else if (data.items.length === 0) {
		const searching = state.operation?.phase === "initial" && committedSearch !== "";
		let emptyIcon: "library" | "search" | "search-x" = "search-x";
		if (searching) {
			emptyIcon = "search";
		} else if (committedSearch === "") {
			emptyIcon = "library";
		}
		content = (
			<section className="grid min-h-96 place-content-center justify-items-center gap-2 text-center">
				<AppIcon
					name={emptyIcon}
					size={committedSearch === "" ? 40 : 36}
					className={clsx("text-text-subtle", searching && "animate-pulse")}
				/>
				{searching ? (
					<p className="text-sm text-text-muted">Searching...</p>
				) : (
					<>
						<h2 className="text-xl font-semibold">
							{committedSearch === ""
								? `${props.record.name} is empty`
								: `No matches in ${props.record.name}`}
						</h2>
						<p className="text-sm text-text-muted">
							{committedSearch === ""
								? "No items have been added to this view yet."
								: `Nothing in this view matches “${committedSearch}”.`}
						</p>
					</>
				)}
			</section>
		);
	} else {
		content = (
			<SavedViewItems
				data={data}
				layout={visible?.layout ?? state.activeLayout}
				tableColumns={props.record.layouts.table.columns}
			/>
		);
	}

	return (
		<main className="h-full overflow-y-auto bg-bg px-4 pb-[max(32px,env(safe-area-inset-bottom))] md:px-8 md:pt-8">
			<div className="grid min-h-full w-full gap-5" aria-busy={state.operation !== undefined}>
				<header className="grid gap-3 md:h-15 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
					<div className="grid min-w-0 gap-1">
						<div className="flex min-w-0 items-center gap-2.5">
							<AppIcon size={20} name={props.record.icon} className="shrink-0 text-text-muted" />
							<h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-text md:font-display md:text-3xl">
								{props.record.name}
							</h1>
						</div>
						<div className="flex min-h-5 items-center gap-2 text-xs text-text-muted md:text-sm">
							<span>{resultCount}</span>
							{data?.pageInfo.hasMore && !transitioning && currentCount.status !== "resolved" && (
								<Button
									variant="text"
									onClick={() => void countAll()}
									className="min-h-0 text-sm text-accent-text"
									disabled={currentCount.status === "counting"}
								>
									{countActionLabel}
								</Button>
							)}
							{transitioning && <span role="status">Updating...</span>}
						</div>
					</div>
					<div className="flex items-center gap-2.5 md:self-start">
						<SavedViewSearch
							value={search}
							onChange={setSearch}
							onSubmit={submitSearch}
							name={props.record.name}
						/>
						<LayoutSelector value={state.activeLayout} onChange={selectLayout} />
					</div>
				</header>

				{content}

				{state.failure !== undefined && data !== undefined && (
					<div role="alert" className="flex items-center justify-center gap-3 text-sm text-danger">
						<span>
							{state.failedPhase === "load-more"
								? "Could not load more results."
								: "Could not update this view."}
						</span>
						<Button variant="text" className="min-h-0 text-sm" onClick={retryPage}>
							Retry
						</Button>
					</div>
				)}
				{data !== undefined &&
					data.items.length > 0 &&
					!transitioning &&
					state.failure === undefined && (
						<SavedViewPagination
							onLoadMore={loadMore}
							name={props.record.name}
							loaded={data.items.length}
							hasMore={data.pageInfo.hasMore}
							isLoading={state.operation?.phase === "load-more"}
						/>
					)}
			</div>
		</main>
	);
}

function LayoutSelector(props: {
	readonly value: SavedViewLayoutName;
	readonly onChange: (layout: SavedViewLayoutName) => void;
}) {
	return (
		<div
			role="radiogroup"
			aria-label="Saved view layout"
			className="flex h-9 items-center self-start rounded-full bg-surface-2 p-0.75 md:h-8.5 md:items-stretch md:rounded-md md:border md:border-border-strong"
		>
			{(["grid", "list", "table"] as const).map((layout) => {
				const selected = props.value === layout;
				return (
					<button
						role="radio"
						key={layout}
						type="button"
						aria-checked={selected}
						onClick={() => props.onChange(layout)}
						aria-label={`${layout[0]?.toUpperCase()}${layout.slice(1)} view`}
						className={clsx(
							"flex h-7 w-9.5 items-center justify-center rounded-full border border-transparent focus-visible:border-accent focus-visible:outline-none md:w-7.5 md:rounded-sm",
							selected && "bg-raised shadow-sm",
						)}
					>
						<AppIcon
							size={15}
							name={layout}
							className={selected ? "text-accent-text" : "text-text-muted"}
						/>
					</button>
				);
			})}
		</div>
	);
}

function SavedViewSearch(props: {
	readonly name: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
	return (
		<form
			role="search"
			onSubmit={props.onSubmit}
			className="relative h-9.5 min-w-0 flex-1 md:h-8.5 md:w-60 md:flex-none"
		>
			<label className="sr-only" htmlFor="saved-view-search">
				Search {props.name}
			</label>
			<AppIcon
				size={15}
				name="search"
				className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
			/>
			<input
				type="search"
				value={props.value}
				id="saved-view-search"
				placeholder={`Search ${props.name}`}
				onChange={(event) => props.onChange(event.currentTarget.value)}
				className="h-full w-full rounded-full border border-border-strong bg-surface-2 pr-9 pl-9 text-[15px] text-text outline-none placeholder:text-text-subtle focus:border-accent md:rounded-md md:bg-bg md:text-[13px]"
			/>
			{props.value !== "" && (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => props.onChange("")}
					className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted"
				>
					<AppIcon name="x" size={14} />
				</button>
			)}
		</form>
	);
}

function SavedViewPagination(props: {
	readonly name: string;
	readonly loaded: number;
	readonly hasMore: boolean;
	readonly isLoading: boolean;
	readonly onLoadMore: () => void;
}) {
	return (
		<div className="flex w-full flex-col items-center gap-2.5 py-2 md:py-7">
			{props.hasMore ? (
				<button
					type="button"
					disabled={props.isLoading}
					onClick={props.onLoadMore}
					aria-label={props.isLoading ? "Loading more results" : "Load more results"}
					className={clsx(
						"flex h-12 w-full items-center justify-center gap-2 rounded-md bg-surface-2 px-4 text-[15px] text-text md:h-8.5 md:w-auto md:border md:border-border md:bg-card md:text-[13px]",
						props.isLoading && "opacity-60",
					)}
				>
					<AppIcon
						size={16}
						name="chevron-down"
						className={props.isLoading ? "animate-pulse" : "text-text"}
					/>
					{props.isLoading ? "Loading..." : "Load more"}
				</button>
			) : (
				<p className="text-center text-xs text-text-subtle">
					End of {props.name} · {props.loaded.toLocaleString()} items
				</p>
			)}
		</div>
	);
}

const isCardItem = (item: SavedViewItem): item is SavedViewCardResultItem => "title" in item;
const isTableItem = (item: SavedViewItem): item is SavedViewTableResultItem => "cells" in item;

function SavedViewItems(props: {
	readonly data: SavedViewData;
	readonly layout: SavedViewLayoutName;
	readonly tableColumns: Parameters<typeof SavedViewTable>[0]["columns"];
}) {
	if (props.layout === "grid") {
		return (
			<SavedViewGrid
				managedUrls={props.data.managedUrls}
				items={props.data.items.filter(isCardItem)}
			/>
		);
	}
	if (props.layout === "list") {
		return (
			<SavedViewList
				managedUrls={props.data.managedUrls}
				items={props.data.items.filter(isCardItem)}
			/>
		);
	}
	return (
		<SavedViewTable
			columns={props.tableColumns}
			managedUrls={props.data.managedUrls}
			items={props.data.items.filter(isTableItem)}
		/>
	);
}

const savedViewResultLabel = (loaded: number, hasMore: boolean, count: CountState) => {
	if (hasMore && count.status === "resolved") {
		return `${loaded.toLocaleString()} of ${count.total.toLocaleString()} results`;
	}
	return `${loaded.toLocaleString()}${hasMore ? "+" : ""} ${loaded === 1 && !hasMore ? "result" : "results"}`;
};

function SavedViewInlineError(props: { readonly onRetry: () => void }) {
	return (
		<section className="grid min-h-96 place-content-center justify-items-center gap-2 text-center">
			<h2 className="text-xl font-semibold">Saved view unavailable</h2>
			<p className="text-sm text-text-muted">The saved view results could not be loaded.</p>
			<Button
				variant="text"
				onClick={props.onRetry}
				className="mt-2 min-h-0 text-sm text-accent-text"
			>
				Try again
			</Button>
		</section>
	);
}

function SavedViewPending() {
	return <SavedViewNotice title="Loading saved view" message="Loading saved view..." />;
}

function SavedViewNotFound() {
	return <SavedViewNotice title="Saved view not found" message="This saved view does not exist." />;
}

function SavedViewError(props: { readonly error: Error }) {
	const router = useRouter();
	const invalidDefinition =
		props.error instanceof SavedViewLoadError &&
		props.error.stage === "page" &&
		(!(props.error.cause instanceof RyotClientError) ||
			props.error.cause.reason === "malformed-result");
	return (
		<SavedViewNotice
			action={<Button onClick={() => void router.invalidate()}>Retry</Button>}
			title={invalidDefinition ? "Saved view cannot be displayed" : "Saved view unavailable"}
			message={
				invalidDefinition
					? "This saved view has an invalid definition."
					: "The saved view could not be loaded."
			}
		/>
	);
}

function SavedViewNotice(props: {
	readonly title: string;
	readonly message: string;
	readonly action?: React.ReactNode;
}) {
	return (
		<main className="grid h-full min-h-96 place-content-center px-4 text-center">
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
