import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { DescribeResponse, PluginExecutionSource } from "@ryot-app/plugin-client-sdk";
import {
	type AddAction,
	addToCollectionAction,
	BrowserInlineError,
	type BrowserQueryInput,
	type BrowserResultsInput,
	EntityBrowserController,
	EntityBrowserResults,
} from "@ryot-app/plugin-client-sdk/browser";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	useDisplayText,
	useHostScreen,
	useRyot,
	useRyotQuery,
	useRyotSchedule,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { queryFilterFields } from "@ryot-app/ryotql-recipes/filters";
import {
	decodeEntityBrowserResult,
	decodeSavedViewCount,
	decodeSavedViewIds,
	EntityBrowserPageInput,
	type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { type ComponentProps, type ReactNode, useState } from "react";

export type EntityBrowserResultsRenderer = (
	input: BrowserResultsInput<EntityBrowserResult>,
) => ReactNode;

type BrowserViewInput = Pick<typeof EntityBrowserPageInput.Type, "view" | "target" | "settings">;

type ControllerProps = ComponentProps<typeof EntityBrowserController<EntityBrowserResult, Error>>;

const controlsQuery = createRyotQuery<
	typeof EntityBrowserPageInput.Type.target,
	typeof DescribeResponse.Type
>(({ input, client }) =>
	client.data.describe({ query: "count", kind: "savedView", reference: input.reference }),
);

type EntityBrowserPageProps = {
	readonly add?: AddAction | undefined;
	readonly shareable?: boolean | undefined;
	readonly renderResults?: undefined | EntityBrowserResultsRenderer;
};

export const EntityBrowserView = ({
	add,
	input,
	controls,
	errorTitle,
	selectable,
	viewContext,
	menuActions,
	errorMessage,
	renderSummary,
	renderResults,
}: Omit<EntityBrowserPageProps, "shareable"> & {
	readonly selectable: boolean;
	readonly input: BrowserViewInput;
	readonly errorTitle: ControllerProps["errorTitle"];
	readonly menuActions?: ControllerProps["menuActions"];
	readonly errorMessage: ControllerProps["errorMessage"];
	readonly renderSummary?: ControllerProps["renderSummary"];
	readonly viewContext: ComponentProps<typeof EntityBrowserResults>["viewContext"];
	readonly controls: {
		readonly sortChoices: typeof DescribeResponse.Type.sort;
		readonly filterFields: ReturnType<typeof queryFilterFields>;
	};
}) => {
	const ryot = useRyot();
	const schedule = useRyotSchedule();
	const source = (query: string): PluginExecutionSource => ({
		query,
		kind: "savedView",
		reference: input.target.reference,
	});
	const argumentsFor = (searchText: string) =>
		input.settings.controls?.search === undefined
			? {}
			: { [input.settings.controls.search]: searchText };
	const [query] = useState(() =>
		createRyotQuery<BrowserQueryInput, EntityBrowserResult, Error>(
			({ client, input: { filter, cursor, searchText, sortChoice } }) =>
				client.data.execute(
					{
						arguments: argumentsFor(searchText),
						source: source(input.settings.sourceName),
						...(filter === null ? {} : { filter }),
						...(sortChoice === "" ? {} : { sort: sortChoice }),
						pages: {
							[input.settings.sourceName]: {
								limit: input.settings.pageSize,
								...(cursor === null ? {} : { after: cursor }),
							},
						},
					},
					(response) =>
						decodeEntityBrowserResult(response, input.settings.sourceName, input.settings),
				),
			{ cancelOnUnmount: true },
		),
	);
	const t = useT();
	const displayText = useDisplayText();
	const viewName = input.view
		? displayText(input.view.name)
		: t(kernelMessage("renderer.entity-browser.title"));
	const addAction = input.settings.addAction;
	return (
		<EntityBrowserController
			query={query}
			name={viewName}
			errorTitle={errorTitle}
			menuActions={menuActions}
			errorMessage={errorMessage}
			renderSummary={renderSummary}
			layouts={input.settings.layouts}
			sortChoices={controls.sortChoices}
			icon={input.view?.icon ?? "library"}
			filterFields={controls.filterFields}
			identityKey={JSON.stringify(viewContext)}
			canSearch={input.settings.controls?.search !== undefined}
			defaultLayout={
				input.settings.layouts.includes(input.settings.defaultLayout)
					? input.settings.defaultLayout
					: input.settings.layouts[0]
			}
			count={(client, { filter, searchText }) =>
				client.data.execute(
					{
						source: source("count"),
						arguments: argumentsFor(searchText),
						...(filter === null ? {} : { filter }),
					},
					decodeSavedViewCount,
				)
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
			selection={
				selectable
					? {
							actions: [addToCollectionAction(ryot)],
							readIds: (client, { after, filter, searchText }) =>
								client.data.execute(
									{
										source: source("ids"),
										arguments: argumentsFor(searchText),
										...(filter === null ? {} : { filter }),
										pages: { ids: after === undefined ? {} : { after } },
									},
									decodeSavedViewIds,
								),
						}
					: undefined
			}
			add={
				add ??
				(addAction === null
					? undefined
					: {
							searchesOnline: true,
							label: t(kernelMessage("common.action.add")),
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
	const t = useT();
	const controls = useRyotQuery(controlsQuery, input.target);
	const errorTitle = t(kernelMessage("renderer.entity-browser.unavailable"));
	if (controls.data === undefined) {
		return (
			<PluginScreenFrame
				title={input.view ? input.view.name : kernelMessage("renderer.entity-browser.title")}
			>
				{controls.isError ? (
					<BrowserInlineError
						title={errorTitle}
						onRetry={controls.refetch}
						message={t(kernelMessage("renderer.entity-browser.filters-failed"))}
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
			errorTitle={errorTitle}
			renderResults={renderResults}
			key={JSON.stringify(controls.data)}
			viewContext={{ savedView: input.target.reference }}
			errorMessage={t(kernelMessage("renderer.entity-browser.results-failed"))}
			controls={{
				sortChoices: controls.data.sort,
				filterFields: queryFilterFields(controls.data.filter),
			}}
			menuActions={
				shareable === false
					? undefined
					: [
							{
								key: "share",
								icon: "share",
								label: t(kernelMessage("common.action.share")),
								onSelect: () =>
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
	const t = useT();
	const page = Schema.decodeUnknownResult(EntityBrowserPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title={kernelMessage("renderer.entity-browser.title")}>
			<StatusMessage tone="error">
				{t(kernelMessage("renderer.entity-browser.invalid"))}
			</StatusMessage>
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
