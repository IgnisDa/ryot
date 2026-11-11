import type { DescribeResponse } from "@ryot-app/plugin-client-sdk";
import { BrowserInlineError, countLabel } from "@ryot-app/plugin-client-sdk/browser";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext, usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { type BrowseSchema, loadEntitySchemaBrowse } from "@ryot-app/ryotql-recipes/browse";
import { queryFilterFields } from "@ryot-app/ryotql-recipes/filters";
import {
	publicationBrowse,
	publicationBrowserSource,
	type PublicationSubjectSchema,
	publicationSubjectSchemasRecipe,
} from "@ryot-app/ryotql-recipes/publication-browse";
import { useState } from "react";

import { EntityBrowserView } from "./entity-browser";
import { PublicationItem } from "./publication-item";

const PublicationPageInput = Schema.Struct({
	view: Schema.NullOr(Schema.Struct({ icon: Schema.String, name: Schema.String })),
	target: Schema.Struct({ publicationId: Schema.String, kind: Schema.Literal("publication") }),
	settings: Schema.Struct({
		itemCount: Schema.Int,
		ownerName: Schema.NullOr(Schema.String),
		description: Schema.NullOr(Schema.String),
	}),
});

const subjectsQuery = createRyotQuery<
	string,
	{
		readonly browse: readonly BrowseSchema[];
		readonly schemas: readonly PublicationSubjectSchema[];
	}
>(({ client }) =>
	Effect.gen(function* () {
		const schemas = yield* client.data.query(publicationSubjectSchemasRecipe, {});
		const [first, ...rest] = schemas;
		if (first === undefined) {
			return { schemas, browse: [] };
		}
		const browse = yield* loadEntitySchemaBrowse([first, ...rest], (recipe) =>
			client.data.query(recipe, {}),
		);
		return { schemas, browse: publicationBrowse(browse) };
	}),
);

const PublicationSummary = ({
	settings,
}: {
	readonly settings: typeof PublicationPageInput.Type.settings;
}) => (
	<header className="grid gap-2">
		{settings.description === null ? null : (
			<p className="max-w-prose text-sm text-text-muted">{settings.description}</p>
		)}
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
			{settings.ownerName === null ? null : (
				<>
					<span>
						Shared by <strong className="font-semibold text-text">{settings.ownerName}</strong>
					</span>
					<span aria-hidden>·</span>
				</>
			)}
			<span>{countLabel(settings.itemCount)}</span>
		</p>
	</header>
);

const PublicationBrowser = ({ input }: { readonly input: typeof PublicationPageInput.Type }) => {
	const itemId = usePluginSearch().get("item");
	const subjects = useRyotQuery(subjectsQuery, input.target.publicationId);
	const title = input.view?.name ?? "Publication";
	const [controlQuery] = useState(() =>
		createRyotQuery<readonly PublicationSubjectSchema[], null | typeof DescribeResponse.Type>(
			({ client, input: schemas }) => {
				const [first, ...rest] = schemas;
				return first === undefined
					? Effect.succeed(null)
					: client.data.describe({
							kind: "inline",
							query: "source",
							document: publicationBrowserSource([first, ...rest]).dataSources,
						});
			},
		),
	);
	const controls = useRyotQuery(controlQuery, subjects.data?.schemas ?? []);
	if (subjects.data === undefined) {
		return (
			<PluginScreenFrame title={title}>
				{subjects.isError ? (
					<BrowserInlineError
						onRetry={subjects.refetch}
						title="Publication unavailable"
						message="The published items could not be loaded."
					/>
				) : null}
			</PluginScreenFrame>
		);
	}
	const [first, ...rest] = subjects.data.schemas;
	if (first === undefined) {
		return (
			<PluginScreenFrame title={title}>
				<StatusMessage tone="success">Nothing is published here yet.</StatusMessage>
			</PluginScreenFrame>
		);
	}
	if (itemId !== null && itemId !== "") {
		return (
			<PublicationItem
				entityId={itemId}
				schemas={[first, ...rest]}
				browse={subjects.data.browse}
				publicationId={input.target.publicationId}
			/>
		);
	}
	if (controls.data === undefined || controls.data === null || controls.isError) {
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
		<EntityBrowserView
			selectable={false}
			key={JSON.stringify(subjects.data)}
			errorTitle="Publication unavailable"
			errorMessage="The published items could not be loaded."
			viewContext={{ publication: input.target.publicationId }}
			renderSummary={() => <PublicationSummary settings={input.settings} />}
			input={{ ...publicationBrowserSource([first, ...rest]), view: input.view }}
			controls={{
				sortChoices: controls.data.sort,
				filterFields: queryFilterFields(controls.data.filter),
			}}
		/>
	);
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
