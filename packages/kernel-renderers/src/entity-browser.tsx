import { DateTime, Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { effectiveFilterFields } from "@ryot-app/ryotql-recipes/filters";
import {
	entityBrowserCountRecipe,
	EntityBrowserPageInput,
	entityBrowserRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useEffect, useEffectEvent, useState } from "react";

import {
	type AddAction,
	type BrowserQueryInput,
	type BrowserQueryPage,
	type BrowserResultsRenderer,
	EntityBrowserController,
} from "./entity-browser-controller";

const BrowserCount = ({
	input,
	filter,
	onTotal,
	searchText,
}: {
	readonly searchText: string;
	readonly filter: BrowserQueryInput["filter"];
	readonly input: typeof EntityBrowserPageInput.Type;
	readonly onTotal: (total: number | undefined) => void;
}) => {
	const [query] = useState(() =>
		createRyotQuery<Pick<BrowserQueryInput, "filter" | "searchText">, number>(
			({ client, input: { filter: applied, searchText: search } }) =>
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					return yield* client.data.query(
						Result.getOrThrow(
							entityBrowserCountRecipe(input.dataSources, input.settings, {
								...(search === "" ? {} : { searchText: search }),
								...(applied === null ? {} : { now, filter: applied }),
							}),
						),
					);
				}),
		),
	);
	const result = useRyotQuery(query, { filter, searchText });
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="link">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="link" onClick={result.refetch}>
				Retry count
			</Button>
		);
	}
	return null;
};

type EntityBrowserPageProps = {
	readonly add?: AddAction | undefined;
	readonly renderResults?: BrowserResultsRenderer | undefined;
};

const Browser = ({
	add,
	input,
	renderResults,
}: EntityBrowserPageProps & { readonly input: typeof EntityBrowserPageInput.Type }) => {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const [query] = useState(() =>
		createRyotQuery<BrowserQueryInput, BrowserQueryPage<null>>(
			({ client, input: { filter, cursor, searchText, sortChoice } }) =>
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					const result = yield* client.data.query(
						Result.getOrThrow(
							entityBrowserRecipe({
								settings: input.settings,
								queryDocument: input.dataSources,
								...(searchText === "" ? {} : { searchText }),
								...(sortChoice === "" ? {} : { sortChoice }),
								...(cursor === null ? {} : { after: cursor }),
								...(filter === null ? {} : { now, filter }),
							}),
						),
					);
					return { result, meta: null };
				}),
			{ cancelOnUnmount: true },
		),
	);
	const viewName = input.view?.name ?? "Entity browser";
	const addAction = input.settings.addAction;
	return (
		<EntityBrowserController
			query={query}
			name={() => viewName}
			renderResults={renderResults}
			layouts={input.settings.layouts}
			errorTitle="Saved view unavailable"
			icon={input.view?.icon ?? "library"}
			tableColumns={input.settings.tableColumns}
			canSearch={input.settings.searchFields.length > 0}
			viewContext={{ savedView: input.target.reference }}
			identityKey={JSON.stringify(input.target.reference)}
			errorMessage="The saved view results could not be loaded."
			filterFields={effectiveFilterFields("entity-browser", input.settings)}
			sortChoices={input.settings.sortChoices.map(({ name, label }) => ({ label, value: name }))}
			defaultLayout={
				input.settings.layouts.includes(input.settings.defaultLayout)
					? input.settings.defaultLayout
					: input.settings.layouts[0]
			}
			// oxlint-disable-next-line react/no-unstable-nested-components -- The slot needs this saved-view input.
			count={({ filter, onTotal, searchText }) => (
				<BrowserCount
					input={input}
					onTotal={onTotal}
					filter={filter ?? null}
					searchText={searchText}
					key={JSON.stringify([input.target.reference, searchText, filter])}
				/>
			)}
			add={
				add ??
				(addAction === null
					? undefined
					: {
							label: "Add to this view",
							open: (initialQuery) => {
								if (addAction.type === "plugin-route") {
									ryot.navigation.push({
										kind: "plugin-route",
										path: addAction.path,
										search: addAction.search,
										packageId: addAction.packageId,
									});
									return;
								}
								schedule.run(
									ryot.screens
										.pickEntity({
											schema: addAction.schema,
											library: addAction.library,
											...(initialQuery === undefined || initialQuery === ""
												? {}
												: { initialQuery }),
										})
										.pipe(Effect.ignore),
									() => undefined,
								);
							},
						})
			}
		/>
	);
};

export default function EntityBrowserPage({ add, renderResults }: EntityBrowserPageProps = {}) {
	const page = Schema.decodeUnknownResult(EntityBrowserPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title="Entity browser">
			<StatusMessage tone="error">This entity browser configuration is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<Browser add={add} input={page.success} renderResults={renderResults} />
	);
}
