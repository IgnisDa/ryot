import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import type { EntityId, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	readonly importEntity: ImportProviderEntity;
	readonly onSelect: (entityId: EntityId) => void;
	readonly onCreate?: undefined | ((query: string) => void);
	readonly selectedProviderId: undefined | SandboxProviderId;
	readonly onSelectProvider: (providerId: SandboxProviderId) => void;
	readonly search: (
		payload: SearchProviderEntitiesBody,
	) => Effect.Effect<SearchProviderEntitiesResponse, ProviderAddLoadError>;
	readonly loadEntities: (input: {
		readonly query: string;
		readonly after: string | undefined;
	}) => Effect.Effect<EntityPickerEntitiesPage, ProviderAddLoadError>;
	readonly loadMaterialized: (input: {
		readonly providerId: SandboxProviderId;
		readonly externalIds: readonly [string, ...string[]];
	}) => Effect.Effect<ReadonlySet<string>, ProviderAddLoadError>;
};

export function EntityPickPanel(props: EntityPickPanelProps) {
	const t = useT();
	const available = props.providers.status === "ready" ? props.providers.providers : [];
	const selected = selectPreferredProvider(available, props.selectedProviderId ?? null);
	const [query, setQuery] = useState(props.initialQuery ?? "");
	const debouncedQuery = useDebouncedQuery(query);
	const trimmed = query.trim();

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="grid gap-3 p-4 pb-3">
				<PickerSearchBar
					query={query}
					onChange={setQuery}
					onClose={props.onClose}
					label={t(kernelMessage("common.action.search"))}
				/>
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
						{t(
							trimmed === ""
								? kernelMessage("client.provider-add.create-new")
								: kernelMessage("client.provider-add.create-query", { query: trimmed }),
						)}
					</Button>
				</div>
			)}
		</div>
	);
}

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
	const t = useT();
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
				<StatusMessage tone="error">
					{t(kernelMessage("client.provider-add.existing.load-failed"))}
				</StatusMessage>
				<Button onClick={pagination.retry}>{t(kernelMessage("common.action.try-again"))}</Button>
			</div>
		) : (
			<Spinner className="py-4" label={t(kernelMessage("client.provider-add.existing.loading"))} />
		);
	}
	return (
		<section
			className="grid gap-1"
			aria-label={t(kernelMessage("client.provider-add.existing.label"))}
		>
			{entities.length === 0 ? (
				<p className="text-sm text-text-muted">
					{t(
						props.query.trim() === ""
							? kernelMessage("client.provider-add.existing.empty")
							: kernelMessage("client.provider-add.existing.no-matches", { query: props.query }),
					)}
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
					{t(kernelMessage("client.provider-add.existing.more-failed"))}
				</StatusMessage>
			) : null}
			{pagination.hasNextPage ? (
				<LoadMoreButton
					disabled={pagination.isFetching}
					onClick={pagination.fetchNextPage}
					isFetchingNextPage={pagination.isFetchingNextPage}
					label={t(kernelMessage("client.provider-add.existing.load-more"))}
					loadingLabel={t(kernelMessage("client.provider-add.existing.loading-more"))}
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
	const t = useT();
	const providerName = t(props.provider.providerName);
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

	const heading = <h3 className="text-sm font-semibold text-text">{providerName}</h3>;
	if (pagination.pages.length === 0 || materializedIds === undefined) {
		return (
			<section className="grid gap-2" aria-label={providerName}>
				{heading}
				{pagination.isError ? (
					<PanelFailure
						className="min-h-24"
						error={pagination.error}
						onRetry={pagination.retry}
						providerName={providerName}
					/>
				) : (
					<Spinner
						className="py-4"
						label={t(kernelMessage("client.provider-add.search.searching"))}
					/>
				)}
			</section>
		);
	}
	const visible = items.filter((item) => !materializedIds.has(item.externalId));
	return (
		<section className="grid gap-2" aria-label={providerName}>
			{heading}
			{visible.length === 0 ? (
				<p className="text-sm text-text-muted">
					{t(kernelMessage("client.provider-add.no-other-results", { query: props.query }))}
				</p>
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
					{t(kernelMessage("client.provider-add.results.more-failed"))}
				</StatusMessage>
			) : null}
			{pagination.hasNextPage ? (
				<LoadMoreButton
					disabled={pagination.isFetching}
					onClick={pagination.fetchNextPage}
					isFetchingNextPage={pagination.isFetchingNextPage}
					label={t(kernelMessage("client.provider-add.results.load-more"))}
					loadingLabel={t(kernelMessage("client.provider-add.results.loading-more"))}
				/>
			) : null}
		</section>
	);
}
