import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
	SearchProviderOptionsResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Chip,
	EmptyState,
	LoadMoreButton,
	RadioGroup,
	StatusMessage,
	useFieldEscape,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	initialSchemaFormValues,
	SchemaForm,
	type SchemaFileUpload,
	type SchemaFormIcons,
	type SchemaAssetUpload,
	type SchemaAssetRenderer,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import clsx from "clsx";
import { Effect, Match } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
	createProviderEntityImportState,
	type ProviderEntityImportEntry,
	providerEntityImportEntry,
	type ProviderEntityImportState,
	setProviderEntityImportEntry,
} from "#/modules/provider-add/import-controller";
import {
	applyProviderOptionsFailure,
	applyProviderOptionsResponse,
	createProviderOptionsState,
	isProviderOptionsRequestCurrent,
	type ProviderOptionsState,
} from "#/modules/provider-add/options-state";
import { selectPreferredProvider } from "#/modules/provider-add/preferred-provider";
import { ProviderSearchResultRow } from "#/modules/provider-add/result-row";
import {
	buildSearchPayload,
	type ProviderSearchResultItem,
} from "#/modules/provider-add/search-controller";
import type { ProviderAddLoadError, ProviderSearchSummary } from "#/modules/provider-add/service";
import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { useFormSeed } from "#/modules/ui/use-form-seed";

const SEARCH_DEBOUNCE_MS = 350;

type ProviderSearchInput = {
	readonly query: string;
	readonly providerId: SandboxProviderId;
	readonly options?: NonNullable<SearchProviderEntitiesBody["options"]> | undefined;
};

type CommittedProviderSearch = { readonly input: ProviderSearchInput; readonly generation: number };

const nonEmptySearchOptions = (
	options: NonNullable<SearchProviderEntitiesBody["options"]>,
): NonNullable<SearchProviderEntitiesBody["options"]> | undefined =>
	Object.keys(options).length === 0 ? undefined : options;

const sameSearchOptions = (
	left: ProviderSearchInput["options"],
	right: ProviderSearchInput["options"],
) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const TRANSPORT_FAILURE = {
	title: "Unable to reach the server",
	detail: "The server could not be reached. Check your connection and try again.",
} as const;

export type ProviderAddOutcome<A> = { readonly cause: unknown } | { readonly value: A };

export type ProviderEntityLinks = ReadonlyMap<string, EntityId>;

export type ProviderSummariesState =
	| { readonly status: "failed" }
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly providers: readonly ProviderSearchSummary[] };

export type ProviderEntityLinksInput = {
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly externalIds: readonly [string, ...string[]];
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
};

type ProviderSearchPanelProps = {
	readonly onClose: () => void;
	readonly onCreateCustom?: ((query: string) => void) | undefined;
	readonly onImported: (entityId: EntityId) => void;
	readonly uploadFile: SchemaFileUpload;
	readonly uploadAsset: SchemaAssetUpload;
	readonly renderAsset: SchemaAssetRenderer;
	readonly providers: ProviderSummariesState;
	readonly initialQuery?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly selectedProviderId: SandboxProviderId | undefined;
	readonly onSelectProvider: (providerId: SandboxProviderId) => void;
	readonly loadSearchOptions: (
		providerId: SandboxProviderId,
	) => Effect.Effect<SearchProviderOptionsResponse, ProviderAddLoadError>;
	readonly loadEntityLinks: (
		input: ProviderEntityLinksInput,
	) => Effect.Effect<ProviderEntityLinks, ProviderAddLoadError>;
	readonly search: (
		payload: SearchProviderEntitiesBody,
	) => Effect.Effect<SearchProviderEntitiesResponse, ProviderAddLoadError>;
	readonly importEntity: (input: {
		readonly externalId: string;
		readonly providerId: SandboxProviderId;
		readonly onProgress: (entry: ProviderEntityImportEntry) => void;
	}) => Effect.Effect<ProviderEntityImportEntry, ProviderAddLoadError>;
};

const schemaFormIcons: SchemaFormIcons = {
	close: <AppIcon name="x" size={14} />,
	check: <AppIcon size={14} name="check" />,
	upload: <AppIcon size={15} name="upload" />,
	search: <AppIcon size={15} name="search" />,
	remove: <AppIcon size={14} name="trash-2" />,
	file: <AppIcon size={15} name="file-text" />,
	chevron: <AppIcon size={15} name="chevron-down" />,
};

function StatusLine(props: { readonly text: string }) {
	return <p className="text-sm text-text-muted">{props.text}</p>;
}

function Spinner(props: { readonly label: string; readonly className?: string }) {
	return (
		<div
			role="status"
			aria-label={props.label}
			className={clsx("flex justify-center", props.className)}
		>
			<AppIcon size={18} name="search" className="animate-pulse text-text-subtle" />
		</div>
	);
}

function PanelFailure(props: { readonly className?: string }) {
	return (
		<div className={clsx("flex flex-col items-center justify-center gap-3 px-6", props.className)}>
			<p className="text-center text-base font-medium text-text">{TRANSPORT_FAILURE.title}</p>
			<StatusMessage tone="error" className="max-w-xl text-center text-sm">
				{TRANSPORT_FAILURE.detail}
			</StatusMessage>
		</div>
	);
}

function ProviderChips(props: {
	readonly providers: readonly ProviderSearchSummary[];
	readonly selectedProviderId: SandboxProviderId | undefined;
	readonly onSelect: (provider: ProviderSearchSummary) => void;
}) {
	const options = props.providers.map((provider) => ({
		provider,
		value: provider.providerId,
		label: provider.providerName,
	}));

	return (
		<div className="overflow-x-auto">
			<RadioGroup
				options={options}
				label="Search provider"
				className="flex gap-1.5"
				value={props.selectedProviderId}
				renderOption={(option, selected) => ({
					content: <Chip checked={selected} label={option.label} />,
				})}
				onChange={(value) => {
					const selected = options.find((option) => option.value === value);
					if (selected !== undefined) {
						props.onSelect(selected.provider);
					}
				}}
			/>
		</div>
	);
}

function ProviderSearchResultList(props: {
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly onAdd: (externalId: string) => void;
	readonly importState: ProviderEntityImportState;
	readonly items: readonly ProviderSearchResultItem[];
	readonly loadEntityLinks: ProviderSearchPanelProps["loadEntityLinks"];
}) {
	const [loadedLinks, setLoadedLinks] = useState<{
		readonly request: string;
		readonly links: ProviderEntityLinks | undefined;
	}>();
	const linksRequest = JSON.stringify([
		props.items.map((item) => item.externalId),
		props.entitySchemaSlug,
		props.librarySchemaSlug,
		props.providerId,
		props.relationshipSlug,
	]);
	const links = loadedLinks?.request === linksRequest ? loadedLinks.links : undefined;
	const loadLinks = useEffectEvent((request: string, isActive: () => boolean) => {
		if (props.items.length === 0) {
			return;
		}
		const externalIds: readonly [string, ...string[]] = [
			props.items[0].externalId,
			...props.items.slice(1).map((item) => item.externalId),
		];
		void Effect.runPromise(
			props
				.loadEntityLinks({
					externalIds,
					providerId: props.providerId,
					entitySchemaSlug: props.entitySchemaSlug,
					relationshipSlug: props.relationshipSlug,
					librarySchemaSlug: props.librarySchemaSlug,
				})
				.pipe(
					Effect.match({ onFailure: () => undefined, onSuccess: (linkMap) => linkMap }),
					Effect.tap((linkMap) =>
						Effect.sync(() => {
							if (isActive()) {
								setLoadedLinks({ request, links: linkMap });
							}
						}),
					),
				),
		);
	});

	useEffect(() => {
		let active = true;
		loadLinks(linksRequest, () => active);
		return () => {
			active = false;
		};
	}, [linksRequest]);

	return (
		<div className="grid gap-1">
			{props.items.map((item) => (
				<ProviderSearchResultRow
					item={item}
					key={item.externalId}
					onAdd={() => props.onAdd(item.externalId)}
					linkedEntityId={links?.get(item.externalId)}
					entry={providerEntityImportEntry(props.importState, item.externalId)}
				/>
			))}
		</div>
	);
}

function ProviderSearchResults(props: {
	readonly onLoadMore: () => void;
	readonly onRetry: () => void;
	readonly query: string;
	readonly items: readonly ProviderSearchResultItem[];
	readonly hasMore: boolean;
	readonly isFetching: boolean;
	readonly isFetchingNextPage: boolean;
	readonly isRefreshing: boolean;
	readonly errorOperation: "initial" | "refresh" | "append" | null;
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly onAdd: (externalId: string) => void;
	readonly importState: ProviderEntityImportState;
	readonly loadEntityLinks: ProviderSearchPanelProps["loadEntityLinks"];
}) {
	const renderPaginationAction = () => {
		if (props.errorOperation !== null) {
			const message =
				props.errorOperation === "append"
					? "Could not load more results."
					: "Could not refresh results.";
			return (
				<div className="grid justify-items-center gap-2">
					<StatusMessage tone="error" className="text-center text-sm">
						{message}
					</StatusMessage>
					<Button onClick={props.onRetry} aria-label="Retry provider search">
						Try again
					</Button>
				</div>
			);
		}
		if (!props.hasMore) {
			return null;
		}
		return (
			<LoadMoreButton
				label="Load more results"
				onClick={props.onLoadMore}
				disabled={props.isFetching}
				loadingLabel="Loading more results..."
				isFetchingNextPage={props.isFetchingNextPage}
			/>
		);
	};

	return (
		<div className="grid gap-3">
			{props.items.length === 0 ? (
				<StatusLine text={`No results for "${props.query}".`} />
			) : (
				<ProviderSearchResultList
					onAdd={props.onAdd}
					items={props.items}
					providerId={props.providerId}
					importState={props.importState}
					loadEntityLinks={props.loadEntityLinks}
					entitySchemaSlug={props.entitySchemaSlug}
					relationshipSlug={props.relationshipSlug}
					librarySchemaSlug={props.librarySchemaSlug}
				/>
			)}
			{props.isRefreshing ? <Spinner label="Refreshing results" /> : null}
			{renderPaginationAction()}
		</div>
	);
}

export function ProviderSearchPanel(props: ProviderSearchPanelProps) {
	const available = props.providers.status === "ready" ? props.providers.providers : [];
	const selected = selectPreferredProvider(available, props.selectedProviderId ?? null);

	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
	const [importState, setImportState] = useState(createProviderEntityImportState);
	const [options, setOptions] = useState<ProviderOptionsState>(() =>
		createProviderOptionsState(selected),
	);
	const [query, setQuery] = useState(props.initialQuery ?? "");
	const [searchRevision, setSearchRevision] = useState(0);
	const [committedSearch, setCommittedSearch] = useState<CommittedProviderSearch>();
	const searchGeneration = useRef(0);
	const invalidateSearch = () => {
		setCommittedSearch(undefined);
		setSearchRevision((revision) => revision + 1);
	};
	const changeQuery = (next: string) => {
		if (next === query) {
			return;
		}
		setQuery(next);
		invalidateSearch();
	};
	const commitSearchInput = (input: ProviderSearchInput) => {
		setCommittedSearch({ input, generation: ++searchGeneration.current });
	};
	const optionsSchema = options.status === "ready" ? options.schema : undefined;
	const optionsForm = useSchemaForm({
		schemas: [optionsSchema],
		onSubmit: (values) => {
			if (
				selected === undefined ||
				options.status !== "ready" ||
				options.providerId !== selected.providerId
			) {
				return;
			}
			commitSearchInput({
				query,
				providerId: selected.providerId,
				options: nonEmptySearchOptions(toSchemaFormPayload(options.schema, values)),
			});
		},
	});
	const optionsRequestId = useRef(0);
	const searchInput = useRef<HTMLInputElement>(null);
	useFieldEscape(searchInput, { hasValue: query !== "", onClear: () => changeQuery("") });

	useFormSeed(optionsForm, `${options.providerId}:${options.status}`, () =>
		optionsSchema === undefined ? {} : initialSchemaFormValues(optionsSchema),
	);

	const selectedProviderId = selected?.providerId;
	useValueChange(selectedProviderId, () => {
		setOptions(createProviderOptionsState(selected));
		invalidateSearch();
	});

	const fetchProviderOptions = (provider: ProviderSearchSummary | undefined) => {
		const requestId = ++optionsRequestId.current;
		if (provider === undefined) {
			return Effect.void;
		}
		if (provider.searchOptionsSchema === null) {
			return Effect.void;
		}
		return props.loadSearchOptions(provider.providerId).pipe(
			Effect.match({
				onFailure: (cause): ProviderAddOutcome<SearchProviderOptionsResponse> => ({ cause }),
				onSuccess: (value): ProviderAddOutcome<SearchProviderOptionsResponse> => ({ value }),
			}),
			Effect.tap((result) =>
				Effect.sync(() => {
					if (optionsRequestId.current !== requestId) {
						return;
					}
					setOptions((current) => {
						if (
							!isProviderOptionsRequestCurrent(
								current,
								provider.providerId,
								requestId,
								optionsRequestId.current,
							)
						) {
							return current;
						}
						return "value" in result
							? applyProviderOptionsResponse(current, result.value)
							: applyProviderOptionsFailure(current, result.cause);
					});
				}),
			),
			Effect.asVoid,
		);
	};
	const fetchSelectedProviderOptions = useEffectEvent(
		(providerId: SandboxProviderId | undefined) =>
			void Effect.runPromise(
				fetchProviderOptions(available.find((provider) => provider.providerId === providerId)),
			),
	);

	useEffect(() => {
		fetchSelectedProviderOptions(selectedProviderId);
	}, [selectedProviderId]);

	const requestSearch = () => {
		if (query.trim() === "" || selected === undefined) {
			return;
		}
		if (options.status === "ready" && options.providerId === selected.providerId) {
			Effect.runFork(
				Effect.promise(() => optionsForm.handleSubmit()).pipe(
					Effect.map((errors) => {
						if (errors.length > 0) {
							setAdvancedOptionsOpen(true);
						}
					}),
				),
			);
			return;
		}
		commitSearchInput({ query, providerId: selected.providerId });
	};

	const submitSearch = useEffectEvent(() => requestSearch());
	const debouncedSearch =
		query.trim() === "" || selectedProviderId === undefined
			? undefined
			: JSON.stringify([searchRevision, query, selectedProviderId]);
	const searchDebounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => {
		if (debouncedSearch === undefined) {
			return undefined;
		}
		const timer = setTimeout(() => {
			searchDebounceTimer.current = undefined;
			submitSearch();
		}, SEARCH_DEBOUNCE_MS);
		searchDebounceTimer.current = timer;
		return () => {
			clearTimeout(timer);
			if (searchDebounceTimer.current === timer) {
				searchDebounceTimer.current = undefined;
			}
		};
	}, [debouncedSearch]);

	const retryProviderOptions = () => {
		if (selected?.searchOptionsSchema === null) {
			return;
		}
		setOptions(createProviderOptionsState(selected));
		void Effect.runPromise(fetchProviderOptions(selected));
	};
	const activeOptionCount =
		options.status === "ready"
			? Object.keys(toSchemaFormPayload(options.schema, optionsForm.state.values.fields)).length
			: 0;
	const currentOptions =
		options.status === "ready" && options.providerId === selected?.providerId
			? nonEmptySearchOptions(toSchemaFormPayload(options.schema, optionsForm.state.values.fields))
			: undefined;
	const committedSearchIsCurrent =
		committedSearch !== undefined &&
		selected !== undefined &&
		committedSearch.input.query === query &&
		committedSearch.input.providerId === selected.providerId &&
		sameSearchOptions(committedSearch.input.options, currentOptions);
	const pagination = usePagination<SearchProviderEntitiesResponse, number>({
		initialPageParam: 1,
		enabled: committedSearchIsCurrent,
		getNextPageParam: (page) => page.details?.nextPage ?? null,
		identity: JSON.stringify([committedSearch?.input ?? null, committedSearch?.generation ?? null]),
		load: (page) =>
			committedSearch === undefined
				? Effect.interrupt
				: props.search(buildSearchPayload({ ...committedSearch.input, page })),
	});
	const resultItems = paginationItems(
		pagination.pages,
		(page) => page.items,
		(item) => item.externalId,
	);

	const addProviderEntity = (externalId: string) => {
		const current = providerEntityImportEntry(importState, externalId).status;
		if (selected === undefined || current === "queued" || current === "importing") {
			return;
		}
		const setEntry = (entry: ProviderEntityImportEntry) =>
			setImportState((entries) => setProviderEntityImportEntry(entries, externalId, entry));
		setEntry({ status: "importing" });
		void Effect.runPromise(
			props
				.importEntity({ externalId, onProgress: setEntry, providerId: selected.providerId })
				.pipe(
					Effect.tap((entry) =>
						Effect.sync(() => {
							if (entry.status === "imported") {
								props.onImported(entry.entityId);
							}
							setEntry(entry);
						}),
					),
				),
		);
	};
	const renderSearchState = (provider: ProviderSearchSummary) => {
		if (!committedSearchIsCurrent) {
			return (
				<EmptyState
					className="py-16"
					title={`Search ${provider.providerName}`}
					icon={<AppIcon size={18} name="search" />}
					description="Start typing above to find something to add."
				/>
			);
		}
		if (pagination.pages.length === 0) {
			if (pagination.isError) {
				return (
					<div className="grid gap-2">
						<PanelFailure className="min-h-32" />
						<Button onClick={pagination.retry} aria-label="Try searching again">
							Try again
						</Button>
					</div>
				);
			}
			return <Spinner label="Searching" className="min-h-32 items-center" />;
		}
		return (
			<ProviderSearchResults
				query={query}
				items={resultItems}
				onAdd={addProviderEntity}
				importState={importState}
				onRetry={pagination.retry}
				hasMore={pagination.hasNextPage}
				providerId={provider.providerId}
				isFetching={pagination.isFetching}
				onLoadMore={pagination.fetchNextPage}
				isRefreshing={pagination.isRefreshing}
				loadEntityLinks={props.loadEntityLinks}
				entitySchemaSlug={props.entitySchemaSlug}
				relationshipSlug={props.relationshipSlug}
				errorOperation={pagination.errorOperation}
				librarySchemaSlug={props.librarySchemaSlug}
				isFetchingNextPage={pagination.isFetchingNextPage}
			/>
		);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="grid gap-3 p-4 pb-3">
				<div className="flex items-center gap-2">
					<div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
						<AppIcon size={15} name="search" className="shrink-0 text-text-subtle" />
						<input
							autoFocus
							type="text"
							value={query}
							ref={searchInput}
							placeholder="Search"
							aria-label="Search providers"
							onChange={(event) => changeQuery(event.target.value)}
							className="min-w-0 flex-1 bg-transparent text-base text-text outline-none md:text-sm"
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									if (searchDebounceTimer.current !== undefined) {
										clearTimeout(searchDebounceTimer.current);
										searchDebounceTimer.current = undefined;
									}
									requestSearch();
								}
							}}
						/>
						{query === "" ? null : (
							<button
								type="button"
								aria-label="Clear search"
								onClick={() => changeQuery("")}
								className="flex size-6 shrink-0 items-center justify-center rounded"
							>
								<AppIcon name="x" size={15} className="shrink-0 text-text-subtle" />
							</button>
						)}
					</div>
					<button
						type="button"
						onClick={props.onClose}
						className="flex min-h-6 items-center px-1 md:hidden"
					>
						<span className="text-sm font-medium text-text-muted">Cancel</span>
					</button>
					<button
						type="button"
						aria-label="Close"
						onClick={props.onClose}
						className="hidden md:flex md:h-8 md:w-8 md:items-center md:justify-center md:rounded-md"
					>
						<AppIcon name="x" size={16} className="text-text-muted" />
					</button>
				</div>

				{Match.value(props.providers).pipe(
					Match.when({ status: "loading" }, () => (
						<Spinner label="Loading providers" className="min-h-32 items-center" />
					)),
					Match.when({ status: "failed" }, () => <PanelFailure className="min-h-32" />),
					Match.when({ status: "ready" }, (ready) =>
						ready.providers.length === 0 ? (
							<StatusLine text="No providers are configured for this item type." />
						) : (
							<ProviderChips
								providers={ready.providers}
								selectedProviderId={selected?.providerId}
								onSelect={(provider) => props.onSelectProvider(provider.providerId)}
							/>
						),
					),
					Match.exhaustive,
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				{selected === undefined ? null : (
					<div className="grid gap-3">
						{selected.searchOptionsSchema === null ? null : (
							<>
								<button
									type="button"
									aria-label="Advanced options"
									aria-expanded={advancedOptionsOpen}
									onClick={() => setAdvancedOptionsOpen((current) => !current)}
									className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5"
								>
									<span className="flex items-center gap-2">
										<AppIcon size={15} name="sliders-horizontal" className="text-text-muted" />
										<span className="text-sm font-medium text-text">Advanced options</span>
										{activeOptionCount > 0 ? (
											<span className="text-xs text-text-muted">({activeOptionCount})</span>
										) : null}
									</span>
									<AppIcon
										size={16}
										className="text-text-muted"
										name={advancedOptionsOpen ? "chevron-up" : "chevron-down"}
									/>
								</button>

								{advancedOptionsOpen &&
									(options.providerId !== selected.providerId ? (
										<Spinner label="Loading filters" className="items-center py-2" />
									) : (
										Match.value(options).pipe(
											Match.when({ status: "none" }, () => null),
											Match.when({ status: "loading" }, () => (
												<Spinner label="Loading filters" className="items-center py-2" />
											)),
											Match.when({ status: "failed" }, () => (
												<div className="grid gap-2 rounded-lg bg-surface-2 p-3">
													<p className="text-sm text-text-muted">Could not load filters.</p>
													<Button
														className="justify-self-start"
														onClick={retryProviderOptions}
														aria-label="Retry loading filters"
													>
														Retry
													</Button>
												</div>
											)),
											Match.when({ status: "ready" }, (ready) => (
												<SchemaForm
													form={optionsForm}
													schema={ready.schema}
													icons={schemaFormIcons}
													onChange={invalidateSearch}
													uploadFile={props.uploadFile}
													uploadAsset={props.uploadAsset}
													renderAsset={props.renderAsset}
													onReorder={schemaFormReorderFeedback}
												/>
											)),
											Match.exhaustive,
										)
									))}
							</>
						)}

						{renderSearchState(selected)}
					</div>
				)}
			</div>

			{props.onCreateCustom === undefined ? null : (
				<div className="flex items-center justify-end gap-3 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
					<p className="text-sm text-text-muted">Can't find it?</p>
					<Button variant="secondary" onClick={() => props.onCreateCustom?.(query.trim())}>
						<AppIcon size={15} name="plus" />
						Create custom
					</Button>
				</div>
			)}
		</div>
	);
}
