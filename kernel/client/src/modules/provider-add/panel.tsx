import { Button, Chip, RadioGroup, StatusMessage, useFieldEscape } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import {
	initialSchemaFormValues,
	SchemaForm,
	type SchemaFileUpload,
	type SchemaFormIcons,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/client-ui-sdk/schema-form";
import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
	SearchProviderOptionsResponse,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import clsx from "clsx";
import { Match } from "effect";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

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
	createProviderSearchState,
	hasMoreProviderSearchResults,
	type ProviderSearchOperation,
	providerSearchReducer,
	type ProviderSearchResultItem,
	type ProviderSearchState,
} from "#/modules/provider-add/search-controller";
import type { ProviderSearchSummary } from "#/modules/provider-add/service";

const SEARCH_DEBOUNCE_MS = 350;

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

export const resolveLibraryMembership = (
	ownerPluginId: string | undefined,
	entitySchemaSlug: EntitySchemaSlug,
) => {
	if (ownerPluginId === "fitness" && entitySchemaSlug === "exercise") {
		return {
			librarySchemaSlug: "fitness-library",
			relationshipSlug: "in-fitness-library",
		} as const;
	}
	return { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" } as const;
};

type ProviderSearchPanelProps = {
	readonly onClose: () => void;
	readonly onImported: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly providers: ProviderSummariesState;
	readonly initialQuery?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly selectedProviderId: SandboxProviderId | undefined;
	readonly onSelectProvider: (providerId: SandboxProviderId) => void;
	readonly loadSearchOptions: (
		providerId: SandboxProviderId,
	) => Promise<ProviderAddOutcome<SearchProviderOptionsResponse>>;
	readonly loadEntityLinks: (
		input: ProviderEntityLinksInput,
	) => Promise<ProviderAddOutcome<ProviderEntityLinks>>;
	readonly search: (
		payload: SearchProviderEntitiesBody,
	) => Promise<ProviderAddOutcome<SearchProviderEntitiesResponse>>;
	readonly importEntity: (input: {
		readonly externalId: string;
		readonly providerId: SandboxProviderId;
		readonly onProgress: (entry: ProviderEntityImportEntry) => void;
	}) => Promise<ProviderEntityImportEntry>;
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
	readonly libraryName: string;
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly onAdd: (externalId: string) => void;
	readonly importState: ProviderEntityImportState;
	readonly items: readonly ProviderSearchResultItem[];
	readonly loadEntityLinks: ProviderSearchPanelProps["loadEntityLinks"];
}) {
	const linksRequest = useRef<object | undefined>(undefined);
	const [links, setLinks] = useState<ProviderEntityLinks | undefined>(undefined);
	const externalIdsKey = props.items.map((item) => item.externalId).join(" ");
	const loadLinks = useEffectEvent(async (request: object) => {
		if (props.items.length === 0) {
			return;
		}
		const externalIds: readonly [string, ...string[]] = [
			props.items[0].externalId,
			...props.items.slice(1).map((item) => item.externalId),
		];
		const result = await props.loadEntityLinks({
			externalIds,
			providerId: props.providerId,
			entitySchemaSlug: props.entitySchemaSlug,
			relationshipSlug: props.relationshipSlug,
			librarySchemaSlug: props.librarySchemaSlug,
		});
		if (linksRequest.current !== request) {
			return;
		}
		setLinks("value" in result ? result.value : undefined);
	});

	useEffect(() => {
		const request = {};
		linksRequest.current = request;
		setLinks(undefined);
		void loadLinks(request);
	}, [
		externalIdsKey,
		props.entitySchemaSlug,
		props.librarySchemaSlug,
		props.providerId,
		props.relationshipSlug,
	]);

	return (
		<div className="grid gap-1">
			{props.items.map((item) => (
				<ProviderSearchResultRow
					item={item}
					key={item.externalId}
					libraryName={props.libraryName}
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
	readonly state: ProviderSearchState;
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly libraryName: string;
	readonly relationshipSlug: string;
	readonly librarySchemaSlug: string;
	readonly onAdd: (externalId: string) => void;
	readonly importState: ProviderEntityImportState;
	readonly loadEntityLinks: ProviderSearchPanelProps["loadEntityLinks"];
}) {
	if (props.state.items.length === 0) {
		return <StatusLine text={`No results for "${props.state.query}".`} />;
	}
	return (
		<div className="grid gap-3">
			<ProviderSearchResultList
				onAdd={props.onAdd}
				items={props.state.items}
				providerId={props.providerId}
				importState={props.importState}
				libraryName={props.libraryName}
				loadEntityLinks={props.loadEntityLinks}
				entitySchemaSlug={props.entitySchemaSlug}
				relationshipSlug={props.relationshipSlug}
				librarySchemaSlug={props.librarySchemaSlug}
			/>
			{hasMoreProviderSearchResults(props.state) && props.state.status !== "loading-more" ? (
				<Button onClick={props.onLoadMore} aria-label="Load more results">
					Load more
				</Button>
			) : null}
			{props.state.status === "loading-more" ? <Spinner label="Loading more results" /> : null}
		</div>
	);
}

export function ProviderSearchPanel(props: ProviderSearchPanelProps) {
	const available = props.providers.status === "ready" ? props.providers.providers : [];
	const selected = selectPreferredProvider(available, props.selectedProviderId ?? null);
	const libraryName =
		props.librarySchemaSlug === "fitness-library" ? "fitness library" : "media library";

	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
	const [importState, setImportState] = useState(createProviderEntityImportState);
	const [options, setOptions] = useState<ProviderOptionsState>(() =>
		createProviderOptionsState(selected),
	);
	const [state, dispatch] = useReducer(
		providerSearchReducer,
		props.initialQuery,
		createProviderSearchState,
	);
	const optionsSchema = options.status === "ready" ? options.schema : undefined;
	const optionsForm = useSchemaForm({
		schemas: [optionsSchema],
		onSubmit: () => dispatch({ type: "search-requested" }),
	});
	const lastRunToken = useRef<number | undefined>(undefined);
	const optionsRequestId = useRef(0);
	const searchInput = useRef<HTMLInputElement>(null);
	useFieldEscape(searchInput, {
		hasValue: state.query !== "",
		onClear: () => dispatch({ query: "", type: "query-changed" }),
	});

	useEffect(() => {
		optionsForm.reset(optionsSchema === undefined ? {} : initialSchemaFormValues(optionsSchema));
	}, [options.providerId, optionsForm, optionsSchema]);

	const loadProviderOptions = useEffectEvent(
		async (provider: ProviderSearchSummary | undefined) => {
			const requestId = ++optionsRequestId.current;
			setOptions(createProviderOptionsState(provider));
			if (provider === undefined) {
				return;
			}
			if (provider.searchOptionsSchema === null) {
				return;
			}
			const result = await props.loadSearchOptions(provider.providerId);
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
		},
	);
	const loadCurrentProviderOptions = useEffectEvent(() => loadProviderOptions(selected));

	useEffect(() => {
		dispatch({ type: "provider-changed" });
		void loadCurrentProviderOptions();
	}, [selected?.providerId]);

	const requestSearch = async () => {
		if (options.status === "ready" && options.providerId === selected?.providerId) {
			const errors = await optionsForm.handleSubmit();
			if (errors.length > 0) {
				setAdvancedOptionsOpen(true);
			}
			return;
		}
		dispatch({ type: "search-requested" });
	};

	const submitSearch = useEffectEvent(() => void requestSearch());
	useEffect(() => {
		const timer =
			state.query.trim() === "" ? undefined : setTimeout(() => submitSearch(), SEARCH_DEBOUNCE_MS);
		return () => {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		};
	}, [state.generation, state.query]);

	const retryProviderOptions = () => {
		if (selected?.searchOptionsSchema === null) {
			return;
		}
		void loadProviderOptions(selected);
	};
	const activeOptionCount =
		options.status === "ready"
			? Object.keys(toSchemaFormPayload(options.schema, optionsForm.state.values)).length
			: 0;

	const runSearch = useEffectEvent(async (operation: ProviderSearchOperation) => {
		if (selected === undefined) {
			return;
		}
		const optionPayload =
			options.status === "ready" && options.providerId === selected.providerId
				? toSchemaFormPayload(options.schema, optionsForm.state.values)
				: undefined;
		const result = await props.search(
			buildSearchPayload({
				query: state.query,
				page: operation.page,
				options: optionPayload,
				providerId: selected.providerId,
			}),
		);
		if ("value" in result) {
			dispatch({ token: operation.token, response: result.value, type: "response-received" });
			return;
		}
		dispatch({ type: "request-failed", token: operation.token });
	});

	useEffect(() => {
		const operation = state.operation;
		if (operation === undefined || lastRunToken.current === operation.token) {
			return;
		}
		lastRunToken.current = operation.token;
		void runSearch(operation);
	}, [state.operation]);

	const addProviderEntity = (externalId: string) => {
		const current = providerEntityImportEntry(importState, externalId).status;
		if (selected === undefined || current === "queued" || current === "importing") {
			return;
		}
		const setEntry = (entry: ProviderEntityImportEntry) =>
			setImportState((entries) => setProviderEntityImportEntry(entries, externalId, entry));
		setEntry({ status: "importing" });
		void props
			.importEntity({ externalId, onProgress: setEntry, providerId: selected.providerId })
			.then((entry) => {
				if (entry.status === "imported") {
					props.onImported();
				}
				setEntry(entry);
				return entry;
			});
	};

	return (
		<div className="grid gap-3">
			<div className="flex items-center gap-2">
				<div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
					<AppIcon size={15} name="search" className="shrink-0 text-text-subtle" />
					<input
						autoFocus
						type="text"
						ref={searchInput}
						value={state.query}
						placeholder="Search"
						aria-label="Search providers"
						onChange={(event) => dispatch({ type: "query-changed", query: event.target.value })}
						className="min-w-0 flex-1 bg-transparent text-base text-text outline-none md:text-sm"
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								void requestSearch();
							}
						}}
					/>
					{state.query === "" ? null : (
						<button
							type="button"
							aria-label="Clear search"
							onClick={() => dispatch({ query: "", type: "query-changed" })}
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
												uploadFile={props.uploadFile}
												onChange={() => dispatch({ type: "options-changed" })}
											/>
										)),
										Match.exhaustive,
									)
								))}
						</>
					)}

					{Match.value(state.status).pipe(
						Match.when("idle", () => null),
						Match.when("loading", () => (
							<Spinner label="Searching" className="min-h-32 items-center" />
						)),
						Match.when("failed", () => (
							<div className="grid gap-2">
								<PanelFailure className="min-h-32" />
								<Button aria-label="Try searching again" onClick={() => void requestSearch()}>
									Try again
								</Button>
							</div>
						)),
						Match.orElse(() => (
							<ProviderSearchResults
								state={state}
								onAdd={addProviderEntity}
								importState={importState}
								libraryName={libraryName}
								providerId={selected.providerId}
								loadEntityLinks={props.loadEntityLinks}
								entitySchemaSlug={props.entitySchemaSlug}
								relationshipSlug={props.relationshipSlug}
								librarySchemaSlug={props.librarySchemaSlug}
								onLoadMore={() => dispatch({ type: "next-page-requested" })}
							/>
						)),
					)}
				</div>
			)}
		</div>
	);
}
