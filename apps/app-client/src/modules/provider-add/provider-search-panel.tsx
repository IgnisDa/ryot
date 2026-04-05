import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { ProviderSearchSummary } from "@ryot/ryotql-recipes/provider-search";
import clsx from "clsx";
import { Cause, Effect, Match } from "effect";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { queryProviderSearchOptions, searchProviderEntities } from "@/api/provider-entities";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { AppIcon } from "@/modules/icons";

import { providerEntityLinksAtom, providerSearchAtom, rememberedProviderAtom } from "./atoms";
import {
	createProviderEntityImportState,
	type ProviderEntityImportState,
	providerEntityImportEntry,
	setProviderEntityImportEntry,
} from "./import-controller";
import { addProviderEntityToLibrary, runProviderEntityImport } from "./import-runner";
import { ProviderSearchOptionsForm } from "./options-form";
import { toOptionsPayload, validateOptionValues } from "./options-form-state";
import {
	applyProviderOptionsFailure,
	applyProviderOptionsResponse,
	createProviderOptionsState,
	isProviderOptionsRequestCurrent,
	setProviderOptionErrors,
	updateProviderOption,
	type ProviderOptionsState,
} from "./options-state";
import { ProviderSearchResultRow } from "./result-row";
import {
	buildSearchPayload,
	createProviderSearchState,
	hasMoreProviderSearchResults,
	type ProviderSearchItem,
	type ProviderSearchOperation,
	providerSearchReducer,
	type ProviderSearchState,
} from "./search-controller";
import { mapProviderEntityLinks, mapProviderSummaries, providerAddError } from "./state";
import { selectPreferredProvider } from "./use-preferred-provider";

const SEARCH_DEBOUNCE_MS = 350;

function StatusLine(props: { readonly text: string }) {
	return <Text className="font-ui text-sm text-text-muted">{props.text}</Text>;
}

function StatusMessage(props: { readonly title: string; readonly detail: string }) {
	return (
		<View className="min-h-32 items-center justify-center gap-2 px-6">
			<Text className="font-ui-medium text-base text-text">{props.title}</Text>
			<Text className="text-center font-ui text-sm text-text-muted">{props.detail}</Text>
		</View>
	);
}

function ProviderChips(props: {
	readonly selectedProviderId: SandboxProviderId | undefined;
	readonly providers: readonly ProviderSearchSummary[];
	readonly onSelect: (provider: ProviderSearchSummary) => void;
}) {
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator={false}>
			<View className="flex-row gap-1.5">
				{props.providers.map((provider) => {
					const checked = provider.providerId === props.selectedProviderId;
					return (
						<Pressable
							accessibilityRole="radio"
							key={provider.providerId}
							accessibilityState={{ checked }}
							onPress={() => props.onSelect(provider)}
							accessibilityLabel={provider.providerName}
							className={clsx(
								"h-7 items-center justify-center rounded-pill border px-3",
								checked && "border-accent-border bg-accent-soft",
								!checked && "border-border-strong",
							)}
						>
							<Text
								className={clsx(
									"font-ui-medium text-xs",
									checked && "text-accent-text",
									!checked && "text-text-muted",
								)}
							>
								{provider.providerName}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</ScrollView>
	);
}

function ProviderSearchResultList(props: {
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly onAdd: (externalId: string) => void;
	readonly items: readonly ProviderSearchItem[];
	readonly importState: ProviderEntityImportState;
}) {
	const scope = useApiScope();
	const [first, ...rest] = props.items.map((item) => item.externalId);
	const externalIds = [first, ...rest] as const;
	const links = mapProviderEntityLinks(
		useAtomValue(
			providerEntityLinksAtom({
				...scope,
				externalIds,
				providerId: props.providerId,
				entitySchemaSlug: props.entitySchemaSlug,
			}),
		),
	);
	useInternalRequestFailureLogging(
		`provider entity links ${links.status}`,
		"cause" in links ? links.cause : undefined,
	);
	const linked = links.status === "ready" ? links.externalIds : undefined;

	return (
		<View className="gap-1">
			{props.items.map((item) => (
				<ProviderSearchResultRow
					item={item}
					key={item.externalId}
					onAdd={() => props.onAdd(item.externalId)}
					isLinked={linked?.has(item.externalId) ?? false}
					entry={providerEntityImportEntry(props.importState, item.externalId)}
				/>
			))}
		</View>
	);
}

function ProviderSearchResults(props: {
	readonly onLoadMore: () => void;
	readonly state: ProviderSearchState;
	readonly providerId: SandboxProviderId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly onAdd: (externalId: string) => void;
	readonly importState: ProviderEntityImportState;
}) {
	if (props.state.items.length === 0) {
		return <StatusLine text={`No results for "${props.state.query}".`} />;
	}
	return (
		<View className="gap-3">
			<ProviderSearchResultList
				onAdd={props.onAdd}
				items={props.state.items}
				providerId={props.providerId}
				importState={props.importState}
				entitySchemaSlug={props.entitySchemaSlug}
			/>
			{hasMoreProviderSearchResults(props.state) && props.state.status !== "loading-more" ? (
				<Pressable
					onPress={props.onLoadMore}
					accessibilityRole="button"
					accessibilityLabel="Load more results"
					className="items-center rounded-lg border border-border-strong py-2.5"
				>
					<Text className="font-ui-medium text-sm text-text">Load more</Text>
				</Pressable>
			) : null}
			{props.state.status === "loading-more" ? (
				<ActivityIndicator size="small" accessibilityLabel="Loading more results" />
			) : null}
		</View>
	);
}

export function ProviderSearchPanel(props: {
	readonly onClose: () => void;
	readonly initialQuery?: string;
	readonly onImported: () => void;
	readonly entitySchemaSlug: EntitySchemaSlug;
}) {
	const scope = useApiScope();
	const { serverUrl, userId } = scope;
	const providerScope = { ...scope, entitySchemaSlug: props.entitySchemaSlug };
	const providers = mapProviderSummaries(
		useAtomValue(providerSearchAtom({ ...scope, rootEntitySchemaSlug: props.entitySchemaSlug })),
	);
	useInternalRequestFailureLogging(
		`provider summaries ${providers.status}`,
		"cause" in providers ? providers.cause : undefined,
	);

	const remembered = useAtomValue(rememberedProviderAtom(providerScope));
	const setRemembered = useAtomSet(rememberedProviderAtom(providerScope));
	const available = providers.status === "ready" ? providers.providers : [];
	const selected = selectPreferredProvider(available, remembered);

	const [options, setOptions] = useState<ProviderOptionsState>(() =>
		createProviderOptionsState(selected),
	);
	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
	const [importState, setImportState] = useState(createProviderEntityImportState);
	const [state, dispatch] = useReducer(
		providerSearchReducer,
		props.initialQuery,
		createProviderSearchState,
	);
	const lastRunToken = useRef<number | undefined>(undefined);
	const optionsRequestId = useRef(0);

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
			const result = await Effect.runPromise(
				queryProviderSearchOptions(scope, provider.providerId).pipe(
					Effect.match({
						onFailure: (cause) => ({ cause }) as const,
						onSuccess: (response) => ({ response }) as const,
					}),
				),
			);
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
				return "cause" in result
					? applyProviderOptionsFailure(current, result.cause)
					: applyProviderOptionsResponse(current, result.response);
			});
		},
	);
	const loadCurrentProviderOptions = useEffectEvent(() => loadProviderOptions(selected));

	useEffect(() => {
		dispatch({ type: "provider-changed" });
		void loadCurrentProviderOptions();
	}, [selected?.providerId, serverUrl, userId]);

	useInternalRequestFailureLogging(
		`provider search options ${options.status}`,
		options.status === "failed" ? options.cause : undefined,
	);

	const requestSearch = () => {
		if (options.status === "ready" && options.providerId === selected?.providerId) {
			const errors = validateOptionValues(options.schema, options.values);
			if (errors.size > 0) {
				setAdvancedOptionsOpen(true);
				setOptions((current) => setProviderOptionErrors(current, errors));
				return;
			}
			if (options.errors.size > 0) {
				setOptions((current) => setProviderOptionErrors(current, new Map()));
			}
		}
		dispatch({ type: "search-requested" });
	};

	const submitSearch = useEffectEvent(() => requestSearch());
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
			? Object.keys(toOptionsPayload(options.schema, options.values)).length
			: 0;

	const runSearch = useEffectEvent(async (operation: ProviderSearchOperation) => {
		if (selected === undefined) {
			return;
		}
		const optionPayload =
			options.status === "ready" && options.providerId === selected.providerId
				? toOptionsPayload(options.schema, options.values)
				: undefined;
		const result = await Effect.runPromise(
			searchProviderEntities(
				scope,
				buildSearchPayload({
					query: state.query,
					page: operation.page,
					options: optionPayload,
					providerId: selected.providerId,
				}),
			).pipe(
				Effect.match({
					onFailure: (cause) => ({ cause }) as const,
					onSuccess: (response) => ({ response }) as const,
				}),
			),
		);
		if ("cause" in result) {
			const detail = Cause.isCause(result.cause) ? Cause.pretty(result.cause) : result.cause;
			Effect.runSync(Effect.logWarning("provider search transport-error", detail));
			dispatch({
				type: "request-failed",
				token: operation.token,
			});
			return;
		}
		dispatch({ type: "response-received", token: operation.token, response: result.response });
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
		if (
			selected === undefined ||
			providerEntityImportEntry(importState, externalId).status === "importing"
		) {
			return;
		}
		setImportState((current) =>
			setProviderEntityImportEntry(current, externalId, { status: "importing" }),
		);
		void Effect.runPromise(
			runProviderEntityImport({
				externalId,
				scope,
				providerId: selected.providerId,
				onImported: (entityId) =>
					addProviderEntityToLibrary({ entityId, scope }).pipe(
						Effect.andThen(Effect.sync(() => props.onImported())),
					),
			}),
		).then((entry) =>
			setImportState((current) => setProviderEntityImportEntry(current, externalId, entry)),
		);
	};

	return (
		<View className="gap-3">
			<View className="flex-row items-center gap-2">
				<View className="h-9 min-w-0 flex-1 flex-row items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
					<AppIcon size={15} name="search" className="shrink-0 text-text-subtle" />
					<TextInput
						autoFocus
						returnKeyType="go"
						value={state.query}
						placeholder="Search"
						onSubmitEditing={requestSearch}
						accessibilityLabel="Search providers"
						className="min-w-0 flex-1 font-ui text-sm text-text"
						onChangeText={(query) => dispatch({ type: "query-changed", query })}
					/>
					{state.query === "" ? null : (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Clear search"
							onPress={() => dispatch({ type: "query-changed", query: "" })}
						>
							<AppIcon size={15} name="x" className="shrink-0 text-text-subtle" />
						</Pressable>
					)}
				</View>
				<Pressable
					className="md:hidden"
					onPress={props.onClose}
					accessibilityRole="button"
					accessibilityLabel="Close"
				>
					<Text className="font-ui-medium text-sm text-text-muted">Cancel</Text>
				</Pressable>
				<Pressable
					onPress={props.onClose}
					accessibilityRole="button"
					accessibilityLabel="Close"
					className="hidden md:h-8 md:w-8 md:flex md:items-center md:justify-center md:rounded-md"
				>
					<AppIcon size={16} name="x" className="text-text-muted" />
				</Pressable>
			</View>

			{Match.value(providers).pipe(
				Match.when({ status: "loading" }, () => (
					<View className="min-h-32 items-center justify-center">
						<ActivityIndicator size="small" accessibilityLabel="Loading providers" />
					</View>
				)),
				Match.when({ status: "transport-error" }, (failure) => (
					<StatusMessage {...providerAddError(failure)} />
				)),
				Match.when({ status: "malformed" }, (failure) => (
					<StatusMessage {...providerAddError(failure)} />
				)),
				Match.when({ status: "ready" }, (ready) =>
					ready.providers.length === 0 ? (
						<StatusLine text="No providers are configured for this item type." />
					) : (
						<ProviderChips
							providers={ready.providers}
							selectedProviderId={selected?.providerId}
							onSelect={(provider) => {
								setRemembered(provider.providerId);
							}}
						/>
					),
				),
				Match.exhaustive,
			)}

			{selected === undefined ? null : (
				<View className="gap-3">
					{selected.searchOptionsSchema === null ? null : (
						<>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="Advanced options"
								accessibilityState={{ expanded: advancedOptionsOpen }}
								onPress={() => setAdvancedOptionsOpen((current) => !current)}
								className="flex-row items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2.5"
							>
								<View className="flex-row items-center gap-2">
									<AppIcon name="sliders-horizontal" size={15} className="text-text-muted" />
									<Text className="font-ui-medium text-sm text-text">Advanced options</Text>
									{activeOptionCount > 0 ? (
										<Text className="font-ui text-xs text-text-muted">({activeOptionCount})</Text>
									) : null}
								</View>
								<AppIcon
									size={16}
									className="text-text-muted"
									name={advancedOptionsOpen ? "chevron-up" : "chevron-down"}
								/>
							</Pressable>

							{advancedOptionsOpen &&
								(options.providerId !== selected.providerId ? (
									<View className="items-center py-2">
										<ActivityIndicator size="small" accessibilityLabel="Loading filters" />
									</View>
								) : (
									Match.value(options).pipe(
										Match.when({ status: "none" }, () => null),
										Match.when({ status: "loading" }, () => (
											<View className="items-center py-2">
												<ActivityIndicator size="small" accessibilityLabel="Loading filters" />
											</View>
										)),
										Match.when({ status: "failed" }, () => (
											<View className="gap-2 rounded-lg bg-surface-2 p-3">
												<Text className="font-ui text-sm text-text-muted">
													Could not load filters.
												</Text>
												<Pressable
													accessibilityRole="button"
													onPress={retryProviderOptions}
													accessibilityLabel="Retry loading filters"
													className="self-start rounded-lg border border-border-strong px-3 py-2"
												>
													<Text className="font-ui-medium text-sm text-text">Retry</Text>
												</Pressable>
											</View>
										)),
										Match.when({ status: "ready" }, (ready) => (
											<ProviderSearchOptionsForm
												errors={ready.errors}
												values={ready.values}
												schema={ready.schema}
												onChange={(key, value) => {
													setOptions((current) => updateProviderOption(current, key, value));
													dispatch({ type: "options-changed" });
												}}
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
							<View className="min-h-32 items-center justify-center">
								<ActivityIndicator size="small" accessibilityLabel="Searching" />
							</View>
						)),
						Match.when("failed", () => (
							<View className="gap-2">
								<StatusMessage {...providerAddError({ status: "transport-error" })} />
								<Pressable
									onPress={requestSearch}
									accessibilityRole="button"
									accessibilityLabel="Try searching again"
									className="items-center rounded-lg border border-border-strong py-2.5"
								>
									<Text className="font-ui-medium text-sm text-text">Try again</Text>
								</Pressable>
							</View>
						)),
						Match.orElse(() => (
							<ProviderSearchResults
								state={state}
								importState={importState}
								onAdd={addProviderEntity}
								providerId={selected.providerId}
								entitySchemaSlug={props.entitySchemaSlug}
								onLoadMore={() => dispatch({ type: "next-page-requested" })}
							/>
						)),
					)}
				</View>
			)}
		</View>
	);
}
