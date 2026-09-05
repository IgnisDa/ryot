import { Result, Schema } from "@ryot-app/client-sdk/effect";
import { usePageContext } from "@ryot-app/client-sdk/plugin";
import { createRyotQuery, useRyot, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import {
	EntityBrowserPageInput,
	entityBrowserCountRecipe,
	entityBrowserRecipe,
	type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useEffect, useEffectEvent, useState } from "react";

import { EntityBrowserController, type BrowserQueryPage } from "./entity-browser-controller";

const QueryInput = Schema.Tuple([
	Schema.String,
	Schema.String,
	Schema.NullOr(Schema.String),
	Schema.Number,
]);
const decodeQueryInput = Schema.decodeUnknownSync(Schema.fromJsonString(QueryInput));

const BrowserCount = ({
	input,
	onTotal,
	searchText,
}: {
	readonly searchText: string;
	readonly input: typeof EntityBrowserPageInput.Type;
	readonly onTotal: (total: number | undefined) => void;
}) => {
	const [query] = useState(() =>
		createRyotQuery<string, number>(({ client, signal, input: search }) =>
			client.data.query(
				Result.getOrThrow(
					entityBrowserCountRecipe(
						input.dataSources,
						input.settings,
						search === "" ? {} : { searchText: search },
					),
				),
				{ signal },
			),
		),
	);
	const result = useRyotQuery(query, searchText);
	const report = useEffectEvent((total: number | undefined) => onTotal(total));
	useEffect(() => report(result.data), [result.data]);
	if (result.isPending) {
		return (
			<Button disabled variant="text" className="text-sm text-accent-text">
				Counting...
			</Button>
		);
	}
	if (result.isError) {
		return (
			<Button variant="text" onClick={result.refetch} className="text-sm text-accent-text">
				Retry count
			</Button>
		);
	}
	return null;
};

const Browser = ({ input }: { readonly input: typeof EntityBrowserPageInput.Type }) => {
	const ryot = useRyot();
	const [query] = useState(() =>
		createRyotQuery<string, BrowserQueryPage<null>>(
			async ({ client, signal, input: serialized }) => {
				const [search, sort, after] = decodeQueryInput(serialized);
				const result: EntityBrowserResult = await client.data.query(
					Result.getOrThrow(
						entityBrowserRecipe({
							settings: input.settings,
							queryDocument: input.dataSources,
							...(search === "" ? {} : { searchText: search }),
							...(sort === "" ? {} : { sortChoice: sort }),
							...(after === null ? {} : { after }),
						}),
					),
					{ signal },
				);
				return { result, meta: null, input: serialized };
			},
			{ cancelOnUnmount: true },
		),
	);
	const viewName = input.view?.name ?? "Entity browser";
	const addAction = input.settings.addAction;
	return (
		<EntityBrowserController
			query={query}
			name={() => viewName}
			layouts={input.settings.layouts}
			errorTitle="Saved view unavailable"
			icon={input.view?.icon ?? "library"}
			identityKey={input.target.savedViewId}
			tableColumns={input.settings.tableColumns}
			canSearch={input.settings.searchFields.length > 0}
			viewContext={{ savedViewId: input.target.savedViewId }}
			errorMessage="The saved view results could not be loaded."
			sortChoices={input.settings.sortChoices.map(({ name, label }) => ({ label, value: name }))}
			defaultLayout={
				input.settings.layouts.includes(input.settings.defaultLayout)
					? input.settings.defaultLayout
					: input.settings.layouts[0]
			}
			// oxlint-disable-next-line react/no-unstable-nested-components -- The slot needs this saved-view input.
			count={(search, onTotal) => (
				<BrowserCount
					input={input}
					onTotal={onTotal}
					searchText={search}
					key={JSON.stringify([input.target.savedViewId, search])}
				/>
			)}
			add={
				addAction === null
					? undefined
					: {
							label: "Add to this view",
							open: (initialQuery) =>
								ryot.screens.openProviderSearch({
									ownerPluginId: addAction.ownerPluginId,
									entitySchemaSlug: addAction.entitySchemaSlug,
									...(initialQuery === undefined || initialQuery === "" ? {} : { initialQuery }),
								}),
						}
			}
		/>
	);
};

export default function EntityBrowserPage() {
	const page = Schema.decodeUnknownResult(EntityBrowserPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title="Entity browser">
			<StatusMessage tone="error">This entity browser configuration is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<Browser input={page.success} />
	);
}
