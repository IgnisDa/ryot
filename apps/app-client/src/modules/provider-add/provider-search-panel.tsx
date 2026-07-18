import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Match } from "effect";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { queryProviderSearchOptions, searchProviderEntities } from "@/api/provider-entities";
import { useApiScope } from "@/api/scope";
import { temporaryFileUploadOperation } from "@/api/uploads";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { AppChip } from "@/modules/ui/chip";
import { SchemaForm, useSchemaForm } from "@/modules/ui/schema-form/schema-form";
import {
	initialSchemaFormValues,
	toSchemaFormPayload,
} from "@/modules/ui/schema-form/schema-form-state";
import { AppStatusState } from "@/modules/ui/status-state";

import { providerEntityLinksAtom, providerSearchAtom, rememberedProviderAtom } from "./atoms";
import {
	createProviderEntityImportState,
	type ProviderEntityImportState,
	providerEntityImportEntry,
	setProviderEntityImportEntry,
} from "./import-controller";
import { runProviderEntityImport } from "./import-runner";
import {
	applyProviderOptionsFailure,
	applyProviderOptionsResponse,
	createProviderOptionsState,
	isProviderOptionsRequestCurrent,
	type ProviderOptionsState,
} from "./options-state";
import { selectPreferredProvider } from "./preferred-provider";
import { ProviderSearchResultRow } from "./result-row";
import {
	buildSearchPayload,
	createProviderSearchState,
	hasMoreProviderSearchResults,
	type ProviderSearchResultItem,
	type ProviderSearchOperation,
	providerSearchReducer,
	type ProviderSearchState,
} from "./search-controller";
import {
	mapProviderEntityLinks,
	mapProviderSummaries,
	providerAddError,
	type ProviderSearchSummary,
} from "./state";

const SEARCH_DEBOUNCE_MS = 350;

function StatusLine(props: { readonly text: string }) {
	return <Text className="font-ui text-sm text-text-muted">{props.text}</Text>;
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
						<AppChip
							role="radio"
							checked={checked}
							key={provider.providerId}
							label={provider.providerName}
							onPress={() => props.onSelect(provider)}
						/>
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
	readonly importState: ProviderEntityImportState;
	readonly items: readonly ProviderSearchResultItem[];
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
	const linked = links.status === "ready" ? links.entityIds : undefined;

	return (
		<View className="gap-1">
			{props.items.map((item) => (
				<ProviderSearchResultRow
					item={item}
					key={item.externalId}
					onAdd={() => props.onAdd(item.externalId)}
					linkedEntityId={linked?.get(item.externalId)}
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
				<AppButton
					label="Load more"
					onPress={props.onLoadMore}
					accessibilityLabel="Load more results"
				/>
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
	const optionsSchema = options.status === "ready" ? options.schema : undefined;
	const optionsForm = useSchemaForm({
		schema: optionsSchema,
		onSubmit: () => dispatch({ type: "search-requested" }),
	});
	const uploadFile = temporaryFileUploadOperation(scope);
	const lastRunToken = useRef<number | undefined>(undefined);
	const optionsRequestId = useRef(0);

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
			}),
		).then((entry) => {
			if (entry.status === "imported") {
				props.onImported();
			}
			setImportState((current) => setProviderEntityImportEntry(current, externalId, entry));
			return entry;
		});
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
						accessibilityLabel="Search providers"
						onSubmitEditing={() => void requestSearch()}
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
					<AppStatusState className="min-h-32" {...providerAddError(failure)} />
				)),
				Match.when({ status: "malformed" }, (failure) => (
					<AppStatusState className="min-h-32" {...providerAddError(failure)} />
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
												<AppButton
													label="Retry"
													className="self-start"
													onPress={retryProviderOptions}
													accessibilityLabel="Retry loading filters"
												/>
											</View>
										)),
										Match.when({ status: "ready" }, (ready) => (
											<SchemaForm
												form={optionsForm}
												schema={ready.schema}
												uploadFile={uploadFile}
												onChange={() => {
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
								<AppStatusState
									className="min-h-32"
									{...providerAddError({ status: "transport-error" })}
								/>
								<AppButton
									label="Try again"
									onPress={() => void requestSearch()}
									accessibilityLabel="Try searching again"
								/>
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
