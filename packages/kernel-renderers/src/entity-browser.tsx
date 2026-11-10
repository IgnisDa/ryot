import {
	type AddAction,
	addToCollectionAction,
	BrowserInlineError,
	type BrowserQueryInput,
	type BrowserResultsInput,
	EntityBrowserController,
	EntityBrowserResults,
} from "@ryot-app/plugin-client-sdk/browser";
import { DateTime, Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	useHostScreen,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import {
	type BrowseSchema,
	entitySchemaBrowseRecipe,
	type EntitySchemaBrowseResult,
} from "@ryot-app/ryotql-recipes/browse";
import {
	entityBrowserControls,
	entityBrowserCountRecipe,
	entityBrowserIdsRecipe,
	EntityBrowserPageInput,
	entityBrowserRecipe,
	type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { type ComponentProps, type ReactNode, useState } from "react";

export type EntityBrowserResultsRenderer = (
	input: BrowserResultsInput<EntityBrowserResult>,
) => ReactNode;

type ControllerProps = ComponentProps<typeof EntityBrowserController<EntityBrowserResult, Error>>;

type BrowserViewInput = Pick<
	typeof EntityBrowserPageInput.Type,
	"view" | "settings" | "dataSources"
>;

const browseQuery = createRyotQuery<
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

type EntityBrowserPageProps = {
	readonly add?: AddAction | undefined;
	readonly shareable?: boolean | undefined;
	readonly renderResults?: undefined | EntityBrowserResultsRenderer;
};

export const EntityBrowserView = ({
	add,
	input,
	browse,
	controls,
	errorTitle,
	selectable,
	viewContext,
	errorMessage,
	headerActions,
	renderSummary,
	renderResults,
}: Omit<EntityBrowserPageProps, "shareable"> & {
	readonly errorTitle: string;
	readonly selectable: boolean;
	readonly errorMessage: string;
	readonly input: BrowserViewInput;
	readonly browse: readonly BrowseSchema[];
	readonly headerActions?: ControllerProps["headerActions"];
	readonly renderSummary?: ControllerProps["renderSummary"];
	readonly controls: ReturnType<typeof entityBrowserControls>;
	readonly viewContext: ComponentProps<typeof EntityBrowserResults>["viewContext"];
}) => {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const [query] = useState(() =>
		createRyotQuery<BrowserQueryInput, EntityBrowserResult, Error>(
			({ client, input: { filter, cursor, searchText, sortChoice } }) =>
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					return yield* client.data.query(
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
				}),
			{ cancelOnUnmount: true },
		),
	);
	const viewName = input.view?.name ?? "Entity browser";
	const addAction = input.settings.addAction;
	return (
		<EntityBrowserController
			query={query}
			name={viewName}
			errorTitle={errorTitle}
			errorMessage={errorMessage}
			headerActions={headerActions}
			renderSummary={renderSummary}
			layouts={input.settings.layouts}
			sortChoices={controls.sortChoices}
			icon={input.view?.icon ?? "library"}
			filterFields={controls.filterFields}
			identityKey={JSON.stringify(viewContext)}
			canSearch={input.settings.searchFields.length > 0}
			defaultLayout={
				input.settings.layouts.includes(input.settings.defaultLayout)
					? input.settings.defaultLayout
					: input.settings.layouts[0]
			}
			renderResults={(results) =>
				renderResults?.(results) ?? (
					<EntityBrowserResults
						items={results.items}
						layout={results.layout}
						settled={results.settled}
						viewContext={viewContext}
						selection={results.selection}
						columns={input.settings.tableColumns}
					/>
				)
			}
			count={(client, { filter, searchText }) =>
				Effect.gen(function* () {
					const now = yield* DateTime.now;
					return yield* client.data.query(
						Result.getOrThrow(
							entityBrowserCountRecipe(input.dataSources, input.settings, {
								browse,
								...(searchText === "" ? {} : { searchText }),
								...(filter === null ? {} : { now, filter }),
							}),
						),
					);
				})
			}
			selection={
				selectable
					? {
							actions: [addToCollectionAction(ryot)],
							readIds: (client, { after, filter, searchText }) =>
								Effect.gen(function* () {
									const now = yield* DateTime.now;
									return yield* client.data.query(
										Result.getOrThrow(
											entityBrowserIdsRecipe(input.dataSources, input.settings, {
												browse,
												...(after === undefined ? {} : { after }),
												...(searchText === "" ? {} : { searchText }),
												...(filter === null ? {} : { now, filter }),
											}),
										),
									);
								}),
						}
					: undefined
			}
			add={
				add ??
				(addAction === null
					? undefined
					: {
							label: "Add",
							searchesOnline: true,
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
			selectable
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
