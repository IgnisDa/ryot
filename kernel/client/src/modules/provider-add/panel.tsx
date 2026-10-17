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
import {
	paginationItems,
	type RyotQuery,
	usePagination,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
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
	type SchemaAssetRenderer,
	type SchemaAssetUpload,
	type SchemaFileUpload,
	SchemaForm,
	type SchemaFormIcons,
	type SchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import clsx from "clsx";
import { Effect, Match } from "effect";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import {
	createProviderEntityImportState,
	type ProviderEntityImportEntry,
	providerEntityImportEntry,
	type ProviderEntityImportState,
	setProviderEntityImportEntry,
} from "#/modules/provider-add/import-controller";
import { selectPreferredProvider } from "#/modules/provider-add/preferred-provider";
import { ProviderSearchResultRow } from "#/modules/provider-add/result-row";
import {
	buildSearchPayload,
	type ProviderSearchResultItem,
} from "#/modules/provider-add/search-controller";
import { describeSearchFailure, TRANSPORT_FAILURE } from "#/modules/provider-add/search-failure";
import type { ProviderAddLoadError, ProviderSearchSummary } from "#/modules/provider-add/service";
import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { useFormSeed } from "#/modules/ui/use-form-seed";

export const SEARCH_DEBOUNCE_MS = 350;

type ProviderSearchInput = {
	readonly query: string;
	readonly providerId: SandboxProviderId;
	readonly options?: NonNullable<SearchProviderEntitiesBody["options"]> | undefined;
};

const nonEmptySearchOptions = (
	options: NonNullable<SearchProviderEntitiesBody["options"]>,
): NonNullable<SearchProviderEntitiesBody["options"]> | undefined =>
	Object.keys(options).length === 0 ? undefined : options;

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
	readonly searchOptionsQuery: RyotQuery<
		SandboxProviderId,
		SearchProviderOptionsResponse,
		unknown,
		Error
	>;
	readonly loadEntityLinks: (
		input: ProviderEntityLinksInput,
	) => Effect.Effect<ProviderEntityLinks, ProviderAddLoadError>;
	readonly search: (
		payload: SearchProviderEntitiesBody,
	) => Effect.Effect<SearchProviderEntitiesResponse, ProviderAddLoadError>;
	readonly importEntity: ImportProviderEntity;
};

export type ImportProviderEntity = (input: {
	readonly externalId: string;
	readonly providerId: SandboxProviderId;
	readonly onProgress: (entry: ProviderEntityImportEntry) => void;
}) => Effect.Effect<ProviderEntityImportEntry, ProviderAddLoadError>;

export const schemaFormIcons: SchemaFormIcons = {
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

export function Spinner(props: { readonly label: string; readonly className?: string }) {
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

export function PanelFailure(props: {
	readonly className?: string;
	readonly error?: unknown;
	readonly providerName?: string;
	readonly onRetry?: () => void;
}) {
	const copy =
		props.providerName === undefined
			? TRANSPORT_FAILURE
			: describeSearchFailure(props.error, props.providerName);
	return (
		<div className={clsx("flex flex-col items-center justify-center gap-3 px-6", props.className)}>
			<p className="text-center text-base font-medium text-text">{copy.title}</p>
			<StatusMessage tone="error" className="max-w-xl text-center text-sm">
				{copy.detail}
			</StatusMessage>
			{copy.retryable && props.onRetry !== undefined ? (
				<Button onClick={props.onRetry} aria-label="Try searching again">
					Try again
				</Button>
			) : null}
		</div>
	);
}

export function ProviderChips(props: {
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
		<div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
			<RadioGroup
				options={options}
				label="Search provider"
				className="flex w-max gap-1.5"
				value={props.selectedProviderId}
				renderOption={(option, selected) => ({
					className: "shrink-0",
					content: <Chip checked={selected} label={option.label} className="whitespace-nowrap" />,
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

export function PickerSearchBar(props: {
	readonly query: string;
	readonly label: string;
	readonly onClose: () => void;
	readonly onEnter?: () => void;
	readonly onChange: (query: string) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const onEnter = props.onEnter;
	useFieldEscape(input, { hasValue: props.query !== "", onClear: () => props.onChange("") });
	return (
		<div className="flex items-center gap-2">
			<div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
				<AppIcon size={15} name="search" className="shrink-0 text-text-subtle" />
				<input
					autoFocus
					ref={input}
					type="text"
					value={props.query}
					placeholder="Search"
					aria-label={props.label}
					onChange={(event) => props.onChange(event.target.value)}
					className="min-w-0 flex-1 bg-transparent text-base text-text outline-none md:text-sm"
					onKeyDown={
						onEnter === undefined
							? undefined
							: (event) => {
									if (event.key === "Enter") {
										onEnter();
									}
								}
					}
				/>
				{props.query === "" ? null : (
					<button
						type="button"
						aria-label="Clear search"
						onClick={() => props.onChange("")}
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
	);
}

export function useProviderEntityImports(input: {
	readonly showImported: boolean;
	readonly importEntity: ImportProviderEntity;
	readonly onImported: (entityId: EntityId) => void;
}) {
	const [importState, setImportState] = useState(createProviderEntityImportState);
	const importItem = (providerId: SandboxProviderId, externalId: string) => {
		const current = providerEntityImportEntry(importState, externalId).status;
		if (current === "queued" || current === "importing") {
			return;
		}
		const setEntry = (entry: ProviderEntityImportEntry) =>
			setImportState((entries) => setProviderEntityImportEntry(entries, externalId, entry));
		setEntry({ status: "importing" });
		void Effect.runPromise(
			input.importEntity({ externalId, providerId, onProgress: setEntry }).pipe(
				Effect.tap((entry) =>
					Effect.sync(() => {
						if (entry.status === "imported") {
							input.onImported(entry.entityId);
						}
						if (input.showImported || entry.status !== "imported") {
							setEntry(entry);
						}
					}),
				),
			),
		);
	};
	return { importItem, importState };
}

export function useExternalIdLookup<A>(input: {
	readonly key: string;
	readonly fallback: A;
	readonly externalIds: readonly string[];
	readonly load: (externalIds: readonly [string, ...string[]]) => Effect.Effect<A, unknown>;
}) {
	const [loaded, setLoaded] = useState<{ readonly key: string; readonly value: A }>();
	const load = useEffectEvent((key: string, isActive: () => boolean) => {
		if (input.externalIds.length === 0) {
			return;
		}
		void Effect.runPromise(
			input.load([input.externalIds[0], ...input.externalIds.slice(1)]).pipe(
				Effect.orElseSucceed(() => input.fallback),
				Effect.tap((value) =>
					Effect.sync(() => {
						if (isActive()) {
							setLoaded({ key, value });
						}
					}),
				),
			),
		);
	});
	useEffect(() => {
		let active = true;
		load(input.key, () => active);
		return () => {
			active = false;
		};
	}, [input.key]);
	if (input.externalIds.length === 0) {
		return input.fallback;
	}
	return loaded?.key === input.key ? loaded.value : undefined;
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
	const externalIds = props.items.map((item) => item.externalId);
	const links = useExternalIdLookup<ProviderEntityLinks | undefined>({
		externalIds,
		fallback: undefined,
		key: JSON.stringify([
			externalIds,
			props.entitySchemaSlug,
			props.librarySchemaSlug,
			props.providerId,
			props.relationshipSlug,
		]),
		load: (ids) =>
			props.loadEntityLinks({
				externalIds: ids,
				providerId: props.providerId,
				entitySchemaSlug: props.entitySchemaSlug,
				relationshipSlug: props.relationshipSlug,
				librarySchemaSlug: props.librarySchemaSlug,
			}),
	});

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
	const [query, setQuery] = useState(props.initialQuery ?? "");
	const { importItem, importState } = useProviderEntityImports({
		showImported: true,
		onImported: props.onImported,
		importEntity: props.importEntity,
	});
	const session = { ...props, query, importItem, importState, onQueryChange: setQuery };
	if (selected === undefined) {
		return <ProviderSearchLayout {...session} />;
	}
	return <ProviderSearchSession key={selected.providerId} {...session} provider={selected} />;
}

type ProviderSearchSessionProps = ProviderSearchPanelProps & {
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly provider: ProviderSearchSummary;
	readonly importItem: (providerId: SandboxProviderId, externalId: string) => void;
	readonly importState: ProviderEntityImportState;
};

function ProviderSearchSession(props: ProviderSearchSessionProps) {
	return props.provider.searchOptionsSchema === null ? (
		<ProviderSearchForm {...props} />
	) : (
		<ProviderSearchOptions {...props} />
	);
}

function ProviderSearchOptions(props: ProviderSearchSessionProps) {
	const options = useRyotQuery(props.searchOptionsQuery, props.provider.providerId, {
		refreshOnMutation: false,
	});
	if (!options.isSuccess || options.isFetching || options.data === undefined) {
		return (
			<ProviderSearchLayout {...props}>
				{options.isError && !options.isFetching ? (
					<div className="grid gap-2 rounded-lg bg-surface-2 p-3">
						<p className="text-sm text-text-muted">Could not load filters.</p>
						<Button onClick={options.refetch} aria-label="Retry loading filters">
							Retry
						</Button>
					</div>
				) : (
					<Spinner label="Loading filters" className="items-center py-2" />
				)}
			</ProviderSearchLayout>
		);
	}
	return <ProviderSearchForm {...props} optionsSchema={options.data.schema ?? undefined} />;
}

function ProviderSearchForm(
	props: ProviderSearchSessionProps & {
		readonly optionsSchema?: SearchProviderOptionsResponse["schema"] | undefined;
	},
) {
	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
	const [submitted, setSubmitted] = useState<ProviderSearchInput>();
	const optionsSchema = props.optionsSchema ?? undefined;
	const optionsForm = useSchemaForm({
		schemas: [optionsSchema],
		onSubmit: (values) => {
			if (props.query.trim() === "") {
				return;
			}
			const next = {
				query: props.query.trim(),
				providerId: props.provider.providerId,
				options:
					optionsSchema === undefined
						? undefined
						: nonEmptySearchOptions(toSchemaFormPayload(optionsSchema, values)),
			};
			if (JSON.stringify(next) === JSON.stringify(submitted)) {
				pagination.refetch();
			} else {
				setSubmitted(next);
			}
		},
	});
	useFormSeed(optionsForm, JSON.stringify(optionsSchema), () =>
		optionsSchema === undefined ? {} : initialSchemaFormValues(optionsSchema),
	);
	useValueChange(props.query, () => setSubmitted(undefined));
	const requestSearch = () => {
		if (props.query.trim() === "") {
			return;
		}
		Effect.runFork(
			Effect.promise(() => optionsForm.handleSubmit()).pipe(
				Effect.tap((errors) =>
					Effect.sync(() => {
						if (errors.length > 0) {
							setAdvancedOptionsOpen(true);
						}
					}),
				),
			),
		);
	};
	const pagination = usePagination<SearchProviderEntitiesResponse, number>({
		initialPageParam: 1,
		enabled: submitted !== undefined,
		identity: JSON.stringify(submitted),
		getNextPageParam: (page) => page.details?.nextPage ?? null,
		load: (page) =>
			submitted === undefined
				? Effect.interrupt
				: props.search(buildSearchPayload({ ...submitted, page })),
	});
	const resultItems = paginationItems(
		pagination.pages,
		(page) => page.items,
		(item) => item.externalId,
	);

	const renderSearchState = () => {
		if (submitted === undefined) {
			return (
				<EmptyState
					className="py-16"
					icon={<AppIcon size={18} name="search" />}
					title={`Search ${props.provider.providerName}`}
					description="Start typing above to find something to add."
				/>
			);
		}
		if (pagination.pages.length === 0) {
			if (pagination.isError) {
				return (
					<PanelFailure
						className="min-h-32"
						error={pagination.error}
						onRetry={pagination.retry}
						providerName={props.provider.providerName}
					/>
				);
			}
			return <Spinner label="Searching" className="min-h-32 items-center" />;
		}
		return (
			<ProviderSearchResults
				items={resultItems}
				query={submitted.query}
				onRetry={pagination.retry}
				importState={props.importState}
				hasMore={pagination.hasNextPage}
				providerId={submitted.providerId}
				isFetching={pagination.isFetching}
				onLoadMore={pagination.fetchNextPage}
				isRefreshing={pagination.isRefreshing}
				loadEntityLinks={props.loadEntityLinks}
				entitySchemaSlug={props.entitySchemaSlug}
				relationshipSlug={props.relationshipSlug}
				errorOperation={pagination.errorOperation}
				librarySchemaSlug={props.librarySchemaSlug}
				isFetchingNextPage={pagination.isFetchingNextPage}
				onAdd={(externalId) => props.importItem(submitted.providerId, externalId)}
			/>
		);
	};

	return (
		<optionsForm.Subscribe selector={(state) => state.values.fields}>
			{(fields) => {
				const activeOptionCount =
					optionsSchema === undefined
						? 0
						: Object.keys(toSchemaFormPayload(optionsSchema, fields)).length;
				return (
					<ProviderSearchLayout {...props} fields={fields} onEnter={requestSearch}>
						{optionsSchema === undefined ? null : (
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
						)}
						{advancedOptionsOpen && optionsSchema !== undefined ? (
							<SchemaForm
								form={optionsForm}
								schema={optionsSchema}
								icons={schemaFormIcons}
								uploadFile={props.uploadFile}
								uploadAsset={props.uploadAsset}
								renderAsset={props.renderAsset}
								onReorder={schemaFormReorderFeedback}
								onChange={() => setSubmitted(undefined)}
							/>
						) : null}
						{renderSearchState()}
					</ProviderSearchLayout>
				);
			}}
		</optionsForm.Subscribe>
	);
}

function ProviderSearchLayout(
	props: ProviderSearchPanelProps & {
		readonly query: string;
		readonly onQueryChange: (query: string) => void;
		readonly provider?: ProviderSearchSummary;
		readonly onEnter?: () => void;
		readonly fields?: SchemaFormValues;
		readonly children?: ReactNode;
	},
) {
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const submit = useEffectEvent(() => props.onEnter?.());
	const searchKey =
		props.onEnter === undefined || props.query.trim() === ""
			? undefined
			: JSON.stringify([props.query, props.fields]);
	useEffect(() => {
		if (searchKey === undefined) {
			return undefined;
		}
		const scheduled = setTimeout(() => {
			timer.current = undefined;
			submit();
		}, SEARCH_DEBOUNCE_MS);
		timer.current = scheduled;
		return () => {
			clearTimeout(scheduled);
			if (timer.current === scheduled) {
				timer.current = undefined;
			}
		};
	}, [searchKey]);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="grid gap-3 p-4 pb-3">
				<PickerSearchBar
					query={props.query}
					onClose={props.onClose}
					label="Search providers"
					onChange={props.onQueryChange}
					onEnter={() => {
						if (timer.current !== undefined) {
							clearTimeout(timer.current);
							timer.current = undefined;
						}
						props.onEnter?.();
					}}
				/>
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
								selectedProviderId={props.provider?.providerId}
								onSelect={(provider) => props.onSelectProvider(provider.providerId)}
							/>
						),
					),
					Match.exhaustive,
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
				<div className="grid gap-3">{props.children}</div>
			</div>
			{props.onCreateCustom === undefined ? null : (
				<div className="flex items-center justify-end gap-3 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
					<p className="text-sm text-text-muted">Can't find it?</p>
					<Button variant="secondary" onClick={() => props.onCreateCustom?.(props.query.trim())}>
						<AppIcon size={15} name="plus" />
						Create custom
					</Button>
				</div>
			)}
		</div>
	);
}
