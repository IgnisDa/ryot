import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { ProviderSearchSummary } from "@ryot/ryotql-recipes/provider-search";
import clsx from "clsx";
import { Cause, Effect, Match } from "effect";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { appClient, retryQueryResponse } from "@/api/client";
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
import {
	initialOptionValues,
	type OptionValues,
	toOptionsPayload,
	validateOptionValues,
} from "./options-form-state";
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

const SEARCH_DEBOUNCE_MS = 350;

type OptionsState = {
	readonly values: OptionValues;
	readonly errors: ReadonlyMap<string, string>;
	readonly providerId: SandboxProviderId | undefined;
};

const createOptionsState = (provider: ProviderSearchSummary | undefined): OptionsState => {
	const schema = provider?.searchOptionsSchema ?? null;
	return {
		errors: new Map(),
		providerId: provider?.providerId,
		values: schema === null ? {} : initialOptionValues(schema),
	};
};

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
	readonly onImported: () => void;
	readonly entitySchemaSlug: EntitySchemaSlug;
}) {
	const scope = useApiScope();
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
	const selected =
		available.find((provider) => provider.providerId === remembered) ?? available.at(0);

	const [options, setOptions] = useState(() => createOptionsState(selected));
	const [importState, setImportState] = useState(createProviderEntityImportState);
	const [state, dispatch] = useReducer(providerSearchReducer, undefined, createProviderSearchState);
	const lastRunToken = useRef<number | undefined>(undefined);

	if (options.providerId !== selected?.providerId) {
		setOptions(createOptionsState(selected));
	}

	const requestSearch = () => {
		const schema = selected?.searchOptionsSchema ?? null;
		if (schema !== null) {
			const errors = validateOptionValues(schema, options.values);
			if (errors.size > 0) {
				setOptions({ ...options, errors });
				return;
			}
			if (options.errors.size > 0) {
				setOptions({ ...options, errors: new Map() });
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
	}, [options.values, selected?.providerId, state.query]);

	const runSearch = useEffectEvent(async (operation: ProviderSearchOperation) => {
		if (selected === undefined) {
			return;
		}
		const schema = selected.searchOptionsSchema;
		const result = await Effect.runPromise(
			appClient(scope)
				.request.pipe(
					Effect.flatMap((client) =>
						client.providerEntities.search({
							payload: buildSearchPayload({
								query: state.query,
								page: operation.page,
								providerId: selected.providerId,
								hasOptionsSchema: schema !== null,
								options: schema === null ? {} : toOptionsPayload(schema, options.values),
							}),
						}),
					),
					retryQueryResponse,
				)
				.pipe(
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
								dispatch({ type: "provider-changed" });
							}}
						/>
					),
				),
				Match.exhaustive,
			)}

			{selected === undefined ? null : (
				<View className="gap-3">
					{selected.searchOptionsSchema === null ? null : (
						<ProviderSearchOptionsForm
							errors={options.errors}
							values={options.values}
							schema={selected.searchOptionsSchema}
							onChange={(key, value) => {
								setOptions({ ...options, values: { ...options.values, [key]: value } });
								dispatch({ type: "options-changed" });
							}}
						/>
					)}

					{Match.value(state.status).pipe(
						Match.when("idle", () => <StatusLine text="Type to search this provider." />),
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
