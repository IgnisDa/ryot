import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { DescribeResponse } from "@ryot-app/plugin-client-sdk";
import {
	BrowserInlineError,
	type BrowserQueryInput,
	EntityBrowserController,
	EntityBrowserResults,
	itemCountMessage,
} from "@ryot-app/plugin-client-sdk/browser";
import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext, usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	useDisplayText,
	useRichText,
	useRyotQuery,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
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

const PublicationSummary = ({ settings }: { readonly settings: PublicationInput["settings"] }) => {
	const t = useT();
	const richText = useRichText(kernelMessage);
	return (
		<header className="grid gap-2">
			{settings.description === null ? null : (
				<p className="max-w-prose text-sm text-text-muted">{settings.description}</p>
			)}
			<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
				{settings.ownerName === null ? null : (
					<span>
						{richText("renderer.publication.shared-by", {
							owner: <strong className="font-semibold text-text">{settings.ownerName}</strong>,
						})}
					</span>
				)}
				{settings.ownerName !== null && settings.itemCount !== undefined ? (
					<span aria-hidden>·</span>
				) : null}
				{settings.itemCount === undefined ? null : (
					<span>{t(itemCountMessage(settings.itemCount))}</span>
				)}
			</p>
		</header>
	);
};

const LiveBrowser = ({ input }: { readonly input: PublicationInput }) => {
	const t = useT();
	const displayText = useDisplayText();
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
	const title = input.view
		? displayText(input.view.name)
		: t(kernelMessage("renderer.publication.title"));
	if (controls.data === undefined || controls.isError) {
		return (
			<PluginScreenFrame title={title}>
				{controls.isError ? (
					<BrowserInlineError
						onRetry={controls.refetch}
						title={t(kernelMessage("renderer.publication.unavailable"))}
						message={t(kernelMessage("renderer.publication.controls-failed"))}
					/>
				) : (
					<StatusMessage tone="pending">
						{t(kernelMessage("renderer.publication.loading"))}
					</StatusMessage>
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
			defaultLayout={browser.defaultLayout}
			identityKey={input.target.publicationId}
			canSearch={browser.controls?.search !== undefined}
			filterFields={queryFilterFields(controls.data.filter)}
			errorTitle={t(kernelMessage("renderer.publication.unavailable"))}
			errorMessage={t(kernelMessage("renderer.publication.items-failed"))}
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
	const t = useT();
	const [query] = useState(() =>
		createRyotQuery<null, EntityBrowserResult>(({ client }) =>
			client.page.query("items", {
				decode: (response) => decodeEntityBrowserResult(response, "items", input.settings.browser),
			}),
		),
	);
	const result = useRyotQuery(query, null);
	return (
		<PluginScreenFrame
			title={input.view ? input.view.name : kernelMessage("renderer.publication.title")}
		>
			<div className="grid content-start gap-5">
				<PublicationSummary settings={input.settings} />
				<StatusMessage tone="pending">
					{t(kernelMessage("renderer.publication.snapshot-notice"))}
				</StatusMessage>
				{result.data === undefined && result.isError ? (
					<BrowserInlineError
						onRetry={result.refetch}
						title={t(kernelMessage("renderer.publication.unavailable"))}
						message={t(kernelMessage("renderer.publication.items-failed"))}
					/>
				) : null}
				{result.data?.items.length === 0 ? (
					<StatusMessage tone="success">
						{t(kernelMessage("renderer.publication.empty"))}
					</StatusMessage>
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
	const t = useT();
	const page = Schema.decodeUnknownResult(PublicationPageInput)(usePageContext());
	return Result.isFailure(page) ? (
		<PluginScreenFrame title={kernelMessage("renderer.publication.title")}>
			<StatusMessage tone="error">{t(kernelMessage("renderer.publication.invalid"))}</StatusMessage>
		</PluginScreenFrame>
	) : (
		<PublicationBrowser input={page.success} />
	);
}
