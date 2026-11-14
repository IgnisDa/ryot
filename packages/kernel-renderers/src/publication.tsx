import type { DescribeResponse } from "@ryot-app/plugin-client-sdk";
import {
	BrowserInlineError,
	type BrowserQueryInput,
	countLabel,
	EntityBrowserController,
	EntityBrowserResults,
} from "@ryot-app/plugin-client-sdk/browser";
import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext, usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { queryFilterFields } from "@ryot-app/ryotql-recipes/filters";
import { PublicationItemDetailField } from "@ryot-app/ryotql-recipes/publication-browse";
import {
	decodeEntityBrowserResult,
	decodeSavedViewCount,
	EntityBrowserPageInput,
	type EntityBrowserResult,
} from "@ryot-app/ryotql-recipes/saved-views";
import { useState } from "react";

import { PublicationItem, PublicationResults } from "./publication-item";

const PublicationPageInput = Schema.Struct({
	view: EntityBrowserPageInput.fields.view,
	target: Schema.Struct({ publicationId: Schema.String, kind: Schema.Literal("publication") }),
	settings: Schema.Struct({
		ownerName: Schema.NullOr(Schema.String),
		itemCount: Schema.optionalKey(Schema.Int),
		description: Schema.NullOr(Schema.String),
		mode: Schema.Literals(["live", "snapshot"]),
		browser: EntityBrowserPageInput.fields.settings,
		itemDetails: Schema.Array(PublicationItemDetailField),
	}),
});
type PublicationInput = typeof PublicationPageInput.Type;

const controlsQuery = createRyotQuery<null, typeof DescribeResponse.Type>(({ client }) =>
	client.page.describe("items"),
);

const PublicationSummary = ({ settings }: { readonly settings: PublicationInput["settings"] }) => (
	<header className="grid gap-2">
		{settings.description === null ? null : (
			<p className="max-w-prose text-sm text-text-muted">{settings.description}</p>
		)}
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
			{settings.ownerName === null ? null : (
				<span>
					Shared by <strong className="font-semibold text-text">{settings.ownerName}</strong>
				</span>
			)}
			{settings.ownerName !== null && settings.itemCount !== undefined ? (
				<span aria-hidden>·</span>
			) : null}
			{settings.itemCount === undefined ? null : <span>{countLabel(settings.itemCount)}</span>}
		</p>
	</header>
);

const LiveBrowser = ({ input }: { readonly input: PublicationInput }) => {
	const controls = useRyotQuery(controlsQuery, null);
	const browser = input.settings.browser;
	const [query] = useState(() =>
		createRyotQuery<BrowserQueryInput, EntityBrowserResult, Error>(
			({ client, input: { filter, cursor, searchText, sortChoice } }) =>
				client.page.query("items", {
					arguments: { search: searchText },
					...(filter === null ? {} : { filter }),
					...(sortChoice === "" ? {} : { sort: sortChoice }),
					decode: (response) => decodeEntityBrowserResult(response, "items", browser),
					pages: {
						items: { limit: browser.pageSize, ...(cursor === null ? {} : { after: cursor }) },
					},
				}),
			{ cancelOnUnmount: true },
		),
	);
	const title = input.view?.name ?? "Publication";
	if (controls.data === undefined || controls.isError) {
		return (
			<PluginScreenFrame title={title}>
				{controls.isError ? (
					<BrowserInlineError
						onRetry={controls.refetch}
						title="Publication unavailable"
						message="The publication controls could not be loaded."
					/>
				) : (
					<StatusMessage tone="pending">Loading publication...</StatusMessage>
				)}
			</PluginScreenFrame>
		);
	}
	return (
		<EntityBrowserController
			name={title}
			query={query}
			layouts={browser.layouts}
			sortChoices={controls.data.sort}
			icon={input.view?.icon ?? "library"}
			errorTitle="Publication unavailable"
			defaultLayout={browser.defaultLayout}
			identityKey={input.target.publicationId}
			canSearch={browser.controls?.search !== undefined}
			filterFields={queryFilterFields(controls.data.filter)}
			errorMessage="The published items could not be loaded."
			renderSummary={() => <PublicationSummary settings={input.settings} />}
			count={(client, { filter, searchText }) =>
				client.page.query("count", {
					arguments: { search: searchText },
					...(filter === null ? {} : { filter }),
					decode: decodeSavedViewCount,
				})
			}
			renderResults={(results) => (
				<EntityBrowserResults
					items={results.items}
					selection={undefined}
					layout={results.layout}
					settled={results.settled}
					columns={browser.tableColumns}
					viewContext={{ publication: input.target.publicationId }}
				/>
			)}
		/>
	);
};

const SnapshotBrowser = ({ input }: { readonly input: PublicationInput }) => {
	const [query] = useState(() =>
		createRyotQuery<null, EntityBrowserResult>(({ client }) =>
			client.page.query("items", {
				decode: (response) => decodeEntityBrowserResult(response, "items", input.settings.browser),
			}),
		),
	);
	const result = useRyotQuery(query, null);
	return (
		<PluginScreenFrame title={input.view?.name ?? "Publication"}>
			<div className="grid content-start gap-5">
				<PublicationSummary settings={input.settings} />
				<StatusMessage tone="pending">
					This snapshot shows only the first page captured when it was published.
				</StatusMessage>
				{result.data === undefined && result.isError ? (
					<BrowserInlineError
						onRetry={result.refetch}
						title="Publication unavailable"
						message="The published items could not be loaded."
					/>
				) : null}
				{result.data?.items.length === 0 ? (
					<StatusMessage tone="success">Nothing is published here yet.</StatusMessage>
				) : null}
				{result.data !== undefined && result.data.items.length > 0 ? (
					<PublicationResults
						layout="grid"
						items={result.data.items}
						navigationEnabled={false}
						publicationId={input.target.publicationId}
					/>
				) : null}
			</div>
		</PluginScreenFrame>
	);
};

const PublicationBrowser = ({ input }: { readonly input: PublicationInput }) => {
	const itemId = usePluginSearch().get("item");
	if (input.settings.mode === "snapshot") {
		return <SnapshotBrowser input={input} />;
	}
	if (itemId !== null && itemId !== "") {
		return (
			<PublicationItem
				entityId={itemId}
				browser={input.settings.browser}
				itemDetails={input.settings.itemDetails}
				publicationId={input.target.publicationId}
			/>
		);
	}
	return <LiveBrowser input={input} />;
};

export default function PublicationPage() {
	const page = Schema.decodeUnknownResult(PublicationPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title="Publication">
			<StatusMessage tone="error">This publication page is invalid.</StatusMessage>
		</PluginScreenFrame>
	) : (
		<PublicationBrowser input={page.success} />
	);
}
