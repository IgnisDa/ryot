import { BrowserInlineError, countLabel } from "@ryot-app/plugin-client-sdk/browser";
import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { usePageContext, usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { type BrowseSchema, entitySchemaBrowseRecipe } from "@ryot-app/ryotql-recipes/browse";
import {
	publicationBrowse,
	publicationBrowserControls,
	publicationBrowserSource,
	type PublicationSubjectSchema,
	publicationSubjectSchemasRecipe,
} from "@ryot-app/ryotql-recipes/publication-browse";

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
		const schemas = yield* client.data.query(publicationSubjectSchemasRecipe());
		const [first, ...rest] = schemas;
		if (first === undefined) {
			return { schemas, browse: [] };
		}
		const browse = yield* client.data.query(
			entitySchemaBrowseRecipe({ schemas: [first, ...rest] }),
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
	return (
		<EntityBrowserView
			selectable={false}
			browse={subjects.data.browse}
			key={JSON.stringify(subjects.data)}
			errorTitle="Publication unavailable"
			errorMessage="The published items could not be loaded."
			viewContext={{ publication: input.target.publicationId }}
			controls={publicationBrowserControls(subjects.data.browse)}
			renderSummary={() => <PublicationSummary settings={input.settings} />}
			input={{ ...publicationBrowserSource([first, ...rest]), view: input.view }}
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
