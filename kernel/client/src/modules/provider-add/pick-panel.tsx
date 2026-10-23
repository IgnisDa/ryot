import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import type { EntityId, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { nextPageCursor, paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { EntityPickerEntitiesPage } from "@ryot-app/ryotql-recipes/entity-picker";
import type { Effect } from "effect";
import { useEffect, useState } from "react";

import { providerEntityImportEntry } from "#/modules/provider-add/import-controller";
import {
	type ImportProviderEntity,
	PanelFailure,
	PickerSearchBar,
	ProviderChips,
	type ProviderSummariesState,
	SEARCH_DEBOUNCE_MS,
	Spinner,
	useExternalIdLookup,
	useProviderEntityImports,
} from "#/modules/provider-add/panel";
import { selectPreferredProvider } from "#/modules/provider-add/preferred-provider";
import { ProviderSearchResultRow } from "#/modules/provider-add/result-row";
import { buildSearchPayload } from "#/modules/provider-add/search-controller";
import type { ProviderAddLoadError, ProviderSearchSummary } from "#/modules/provider-add/service";

type EntityPickPanelProps = {
	readonly onClose: () => void;
	readonly initialQuery?: string | undefined;
	readonly providers: ProviderSummariesState;
	readonly selectedProviderId: SandboxProviderId | undefined;
	readonly onSelectProvider: (providerId: SandboxProviderId) => void;
	readonly onCreate?: ((query: string) => void) | undefined;
	readonly onSelect: (entityId: EntityId) => void;
	readonly loadEntities: (input: {
		readonly query: string;
		readonly after: string | undefined;
	}) => Effect.Effect<EntityPickerEntitiesPage, ProviderAddLoadError>;
	readonly loadMaterialized: (input: {
		readonly providerId: SandboxProviderId;
		readonly externalIds: readonly [string, ...string[]];
	}) => Effect.Effect<ReadonlySet<string>, ProviderAddLoadError>;
	readonly search: (
		payload: SearchProviderEntitiesBody,
	) => Effect.Effect<SearchProviderEntitiesResponse, ProviderAddLoadError>;
	readonly importEntity: ImportProviderEntity;
};

function useDebouncedQuery(query: string) {
	const [debounced, setDebounced] = useState(query);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query]);
	return debounced;
}

function ExistingEntities(props: {
	readonly query: string;
	readonly onSelect: (entityId: EntityId) => void;
	readonly loadEntities: EntityPickPanelProps["loadEntities"];
}) {
	const pagination = usePagination<EntityPickerEntitiesPage, string | undefined>({
		identity: props.query,
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		load: (after) => props.loadEntities({ after, query: props.query }),
	});
	const entities = paginationItems(
		pagination.pages,
		(page) => page.items,
		(entity) => entity.id,
	);
	if (pagination.pages.length === 0) {
		return pagination.isError ? (
			<div className="grid justify-items-center gap-2">
				<StatusMessage tone="error">Could not load existing items.</StatusMessage>
				<Button onClick={pagination.retry}>Try again</Button>
			</div>
		) : (
			<Spinner className="py-4" label="Loading existing items" />
		);
	}
	return (
		<section aria-label="Existing" className="grid gap-1">
			{entities.length === 0 ? (
				<p className="text-sm text-text-muted">
					{props.query.trim() === "" ? "Nothing here yet." : `No matches for "${props.query}".`}
				</p>
			) : (
				entities.map((entity) => (
					<Button
						key={entity.id}
						variant="ghost"
						className="w-full justify-start"
						onClick={() => props.onSelect(entity.id)}
					>
						{entity.name}
					</Button>
				))
			)}
			{pagination.errorOperation === "append" ? (
				<StatusMessage tone="error" className="text-sm">
					Could not load more items.
				</StatusMessage>
			) : null}
			{pagination.hasNextPage ? (
				<LoadMoreButton
					label="Load more items"
					disabled={pagination.isFetching}
					onClick={pagination.fetchNextPage}
					loadingLabel="Loading more items..."
					isFetchingNextPage={pagination.isFetchingNextPage}
				/>
			) : null}
		</section>
	);
}

function ProviderResults(props: {
	readonly query: string;
	readonly provider: ProviderSearchSummary;
	readonly onSelect: (entityId: EntityId) => void;
	readonly search: EntityPickPanelProps["search"];
	readonly importEntity: EntityPickPanelProps["importEntity"];
	readonly loadMaterialized: EntityPickPanelProps["loadMaterialized"];
}) {
	const providerId = props.provider.providerId;
	const pagination = usePagination<SearchProviderEntitiesResponse, number>({
		initialPageParam: 1,
		identity: JSON.stringify([props.query, providerId]),
		getNextPageParam: (page) => page.details?.nextPage ?? null,
		load: (page) => props.search(buildSearchPayload({ page, providerId, query: props.query })),
	});
	const items = paginationItems(
		pagination.pages,
		(page) => page.items,
		(item) => item.externalId,
	);
	const externalIds = items.map((item) => item.externalId);
	const materializedIds = useExternalIdLookup<ReadonlySet<string>>({
		externalIds,
		fallback: new Set(),
		key: JSON.stringify([providerId, externalIds]),
		load: (ids) => props.loadMaterialized({ providerId, externalIds: ids }),
	});
	const { importItem, importState } = useProviderEntityImports({
		showImported: false,
		onImported: props.onSelect,
		importEntity: props.importEntity,
	});

	const heading = (
		<h3 className="text-sm font-semibold text-text">{props.provider.providerName}</h3>
	);
	if (pagination.pages.length === 0 || materializedIds === undefined) {
		return (
			<section className="grid gap-2" aria-label={props.provider.providerName}>
				{heading}
				{pagination.isError ? (
					<div className="grid gap-2">
						<PanelFailure className="min-h-24" />
						<Button onClick={pagination.retry} aria-label="Try searching again">
							Try again
						</Button>
					</div>
				) : (
					<Spinner className="py-4" label="Searching" />
				)}
			</section>
		);
	}
	const visible = items.filter((item) => !materializedIds.has(item.externalId));
	return (
		<section className="grid gap-2" aria-label={props.provider.providerName}>
			{heading}
			{visible.length === 0 ? (
				<p className="text-sm text-text-muted">No other results for "{props.query}".</p>
			) : (
				<div className="grid gap-1">
					{visible.map((item) => (
						<ProviderSearchResultRow
							item={item}
							key={item.externalId}
							linkedEntityId={undefined}
							onAdd={() => importItem(providerId, item.externalId)}
							entry={providerEntityImportEntry(importState, item.externalId)}
						/>
					))}
				</div>
			)}
			{pagination.errorOperation === "append" ? (
				<StatusMessage tone="error" className="text-sm">
					Could not load more results.
				</StatusMessage>
			) : null}
			{pagination.hasNextPage ? (
				<LoadMoreButton
					label="Load more results"
					disabled={pagination.isFetching}
					onClick={pagination.fetchNextPage}
					loadingLabel="Loading more results..."
					isFetchingNextPage={pagination.isFetchingNextPage}
				/>
			) : null}
		</section>
	);
}

export function EntityPickPanel(props: EntityPickPanelProps) {
	const available = props.providers.status === "ready" ? props.providers.providers : [];
	const selected = selectPreferredProvider(available, props.selectedProviderId ?? null);
	const [query, setQuery] = useState(props.initialQuery ?? "");
	const debouncedQuery = useDebouncedQuery(query);
	const trimmed = query.trim();

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="grid gap-3 p-4 pb-3">
				<PickerSearchBar query={query} label="Search" onChange={setQuery} onClose={props.onClose} />
				{available.length > 1 ? (
					<ProviderChips
						providers={available}
						selectedProviderId={selected?.providerId}
						onSelect={(provider) => props.onSelectProvider(provider.providerId)}
					/>
				) : null}
			</div>

			<div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 pb-4">
				<ExistingEntities
					query={debouncedQuery}
					onSelect={props.onSelect}
					loadEntities={props.loadEntities}
				/>
				{selected === undefined || debouncedQuery.trim() === "" ? null : (
					<ProviderResults
						provider={selected}
						search={props.search}
						query={debouncedQuery}
						onSelect={props.onSelect}
						importEntity={props.importEntity}
						loadMaterialized={props.loadMaterialized}
					/>
				)}
			</div>

			{props.onCreate === undefined ? null : (
				<div className="flex items-center justify-end gap-3 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
					<Button variant="secondary" onClick={() => props.onCreate?.(trimmed)}>
						<AppIcon size={15} name="plus" />
						{trimmed === "" ? "Create new" : `Create "${trimmed}"`}
					</Button>
				</div>
			)}
		</div>
	);
}
