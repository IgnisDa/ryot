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
import {
	type BrowseSchema,
	entitySchemaBrowseRecipe,
	type EntitySchemaBrowseResult,
} from "@ryot-app/ryotql-recipes/browse";
import {
	entityBrowserControls,
	entityBrowserCountRecipe,
	EntityBrowserPageInput,
	entityBrowserRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";
import { type ComponentProps, useEffect, useEffectEvent, useState } from "react";

import { BrowserInlineError } from "./browser-states";
import {
	type AddAction,
	type BrowserQueryInput,
	type BrowserQueryPage,
	type BrowserResultsRenderer,
	EntityBrowserController,
} from "./entity-browser-controller";
import { useHostScreen } from "./host-screen";

type BrowserViewInput = Pick<
	typeof EntityBrowserPageInput.Type,
	"view" | "settings" | "dataSources"
>;

export const browseQuery = createRyotQuery<
	typeof EntityBrowserPageInput.Type.settings.subject.schemas,
	EntitySchemaBrowseResult
>(({ input, client }) => {
	const [first, ...rest] = input.map(({ slug, owner }) => ({
		slug,
		pluginId: owner.kind === "plugin" ? owner.pluginId : null,
	}));
	return first === undefined
		? Effect.succeed([])
		: client.data.query(entitySchemaBrowseRecipe({ schemas: [first, ...rest] }));
});

const BrowserCount = ({
	input,
	browse,
	filter,
	onTotal,
	searchText,
}: {
	readonly searchText: string;
	readonly input: BrowserViewInput;
	readonly browse: readonly BrowseSchema[];
	readonly filter: BrowserQueryInput["filter"];
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
								browse,
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

type ControllerProps = ComponentProps<typeof EntityBrowserController<null>>;

type EntityBrowserPageProps = {
	readonly add?: AddAction | undefined;
	readonly shareable?: boolean | undefined;
	readonly renderResults?: undefined | BrowserResultsRenderer;
};

export const EntityBrowserView = ({
	add,
	input,
	browse,
	controls,
	errorTitle,
	viewContext,
	errorMessage,
	headerActions,
	renderSummary,
	renderResults,
}: Omit<EntityBrowserPageProps, "shareable"> & {
	readonly errorTitle: string;
	readonly errorMessage: string;
	readonly input: BrowserViewInput;
	readonly browse: readonly BrowseSchema[];
	readonly headerActions?: ControllerProps["headerActions"];
	readonly renderSummary?: ControllerProps["renderSummary"];
	readonly controls: ReturnType<typeof entityBrowserControls>;
	readonly viewContext: ComponentProps<typeof EntityBrowserController>["viewContext"];
}) => {
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
								browse,
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
			errorTitle={errorTitle}
			viewContext={viewContext}
			errorMessage={errorMessage}
			headerActions={headerActions}
			renderSummary={renderSummary}
			renderResults={renderResults}
			layouts={input.settings.layouts}
			sortChoices={controls.sortChoices}
			icon={input.view?.icon ?? "library"}
			filterFields={controls.filterFields}
			identityKey={JSON.stringify(viewContext)}
			tableColumns={input.settings.tableColumns}
			canSearch={input.settings.searchFields.length > 0}
			defaultLayout={
				input.settings.layouts.includes(input.settings.defaultLayout)
					? input.settings.defaultLayout
					: input.settings.layouts[0]
			}
			// oxlint-disable-next-line react/no-unstable-nested-components -- The slot needs this saved-view input.
			count={({ filter, onTotal, searchText }) => (
				<BrowserCount
					input={input}
					browse={browse}
					onTotal={onTotal}
					filter={filter ?? null}
					searchText={searchText}
					key={JSON.stringify([viewContext, searchText, filter])}
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

const BrowseDefinitions = ({
	add,
	input,
	shareable,
	renderResults,
}: EntityBrowserPageProps & { readonly input: typeof EntityBrowserPageInput.Type }) => {
	const ryot = useRyot();
	const openScreen = useHostScreen();
	const browse = useRyotQuery(browseQuery, input.settings.subject.schemas);
	if (browse.data === undefined) {
		return (
			<PluginScreenFrame title={input.view?.name ?? "Entity browser"}>
				{browse.isError ? (
					<BrowserInlineError
						onRetry={browse.refetch}
						title="Saved view unavailable"
						message="The saved view filters could not be loaded."
					/>
				) : null}
			</PluginScreenFrame>
		);
	}
	return (
		<EntityBrowserView
			add={add}
			input={input}
			browse={browse.data}
			renderResults={renderResults}
			key={JSON.stringify(browse.data)}
			errorTitle="Saved view unavailable"
			controls={entityBrowserControls(browse.data)}
			viewContext={{ savedView: input.target.reference }}
			errorMessage="The saved view results could not be loaded."
			headerActions={
				shareable === false
					? undefined
					: [
							{
								icon: "share",
								label: "Share",
								run: () =>
									openScreen(
										ryot.screens.sharePublication({
											source: { kind: "saved-view", reference: input.target.reference },
										}),
									),
							},
						]
			}
		/>
	);
};

export default function EntityBrowserPage({
	add,
	shareable,
	renderResults,
}: EntityBrowserPageProps = {}) {
	const page = Schema.decodeUnknownResult(EntityBrowserPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title="Entity browser">
			<StatusMessage tone="error">This entity browser configuration is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<BrowseDefinitions
			add={add}
			input={page.success}
			shareable={shareable}
			renderResults={renderResults}
		/>
	);
}
