import { Effect, Result } from "@ryot-app/plugin-client-sdk/effect";
import { EntityResults, usePluginChrome } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { BrowseSchema } from "@ryot-app/ryotql-recipes/browse";
import {
	entityBrowserRecipe,
	type EntityBrowserResultItem,
	publicationBrowserSource,
	type PublicationItemDetail,
	publicationItemDetailsRecipe,
	publicationItemLinksRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

import { BrowserInlineError } from "./browser-states";

type SubjectSchema = { readonly slug: string; readonly pluginId: null | string };

type ItemsInput = {
	readonly entityIds: readonly string[];
	readonly browse: readonly BrowseSchema[];
	readonly schemas: readonly [SubjectSchema, ...SubjectSchema[]];
};

const itemsQuery = createRyotQuery<ItemsInput, readonly EntityBrowserResultItem[]>(
	({ input, client }) => {
		if (input.entityIds.length === 0) {
			return Effect.succeed([]);
		}
		const source = publicationBrowserSource(input.schemas, input.entityIds);
		return client.data
			.query(
				Result.getOrThrow(
					entityBrowserRecipe({
						browse: input.browse,
						settings: source.settings,
						pageSize: input.entityIds.length,
						queryDocument: source.dataSources,
					}),
				),
			)
			.pipe(
				Effect.map(({ items }) => {
					const byId = new Map(items.map((item) => [item.entityId, item]));
					return input.entityIds.flatMap((id) => byId.get(id) ?? []);
				}),
			);
	},
);

const detailsQuery = createRyotQuery<
	Parameters<typeof publicationItemDetailsRecipe>[0],
	readonly PublicationItemDetail[]
>(({ input, client }) =>
	input.fields.length === 0
		? Effect.succeed([])
		: client.data.query(publicationItemDetailsRecipe(input)),
);

const linksQuery = createRyotQuery<string, readonly string[]>(({ input, client }) =>
	client.data.query(publicationItemLinksRecipe({ entityId: input })),
);

const formatDetail = (detail: PublicationItemDetail) => {
	if (detail.kind === "list") {
		return detail.value.join(", ");
	}
	if (detail.kind === "number") {
		return detail.value.toLocaleString();
	}
	if (detail.kind === "boolean") {
		return detail.value ? "Yes" : "No";
	}
	if (detail.kind === "date") {
		const parsed = new Date(detail.value);
		return Number.isNaN(parsed.getTime()) ? detail.value : parsed.toLocaleDateString();
	}
	return detail.value;
};

const references = (items: readonly EntityBrowserResultItem[]) =>
	items.map((item) => ({
		name: item.name,
		entityId: item.entityId,
		ownerPluginId: item.ownerPluginId,
		entitySchemaSlug: item.entitySchemaSlug,
		...item.sync,
	}));

const presentations = (items: readonly EntityBrowserResultItem[]) =>
	new Map(
		items.flatMap(({ entityId, presentation }) =>
			presentation === null ? [] : [[entityId, presentation] as const],
		),
	);

const ItemDetails = ({
	browse,
	entityId,
}: {
	readonly entityId: string;
	readonly browse: undefined | BrowseSchema;
}) => {
	const fields = (browse?.browse?.fields ?? []).flatMap((browseField) =>
		browseField.kind === "value" ? [browseField] : [],
	);
	const details = useRyotQuery(detailsQuery, { fields, entityId });
	if (details.data === undefined || details.data.length === 0) {
		return null;
	}
	return (
		<section className="grid gap-3" aria-labelledby="publication-item-details">
			<h2 id="publication-item-details" className="text-sm font-semibold text-text">
				Details
			</h2>
			<dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border p-4 sm:grid-cols-[max-content_1fr]">
				{details.data.map((detail) => (
					<div key={detail.key} className="contents">
						<dt className="text-xs font-medium tracking-wide text-text-muted uppercase sm:pt-0.5">
							{detail.label}
						</dt>
						<dd className="text-sm text-text">{formatDetail(detail)}</dd>
					</div>
				))}
			</dl>
		</section>
	);
};

const RelatedItems = ({
	input,
	viewContext,
}: {
	readonly viewContext: { readonly publication: string };
	readonly input: Omit<ItemsInput, "entityIds"> & { readonly entityId: string };
}) => {
	const links = useRyotQuery(linksQuery, input.entityId);
	const related = useRyotQuery(itemsQuery, {
		browse: input.browse,
		schemas: input.schemas,
		entityIds: links.data ?? [],
	});
	if (related.data === undefined || related.data.length === 0) {
		return null;
	}
	return (
		<section className="grid gap-3" aria-labelledby="publication-item-related">
			<h2 id="publication-item-related" className="text-sm font-semibold text-text">
				Related
			</h2>
			<EntityResults
				layout="grid"
				viewContext={viewContext}
				references={references(related.data)}
				presentations={presentations(related.data)}
			/>
		</section>
	);
};

export const PublicationItem = ({
	browse,
	schemas,
	entityId,
	publicationId,
}: {
	readonly entityId: string;
	readonly publicationId: string;
	readonly browse: readonly BrowseSchema[];
	readonly schemas: readonly [SubjectSchema, ...SubjectSchema[]];
}) => {
	const chrome = usePluginChrome();
	const item = useRyotQuery(itemsQuery, { browse, schemas, entityIds: [entityId] });
	const [found] = item.data ?? [];
	if (item.data === undefined || found === undefined) {
		return (
			<PluginScreenFrame title="Item" backLabel="All items">
				{item.isError ? (
					<BrowserInlineError
						onRetry={item.refetch}
						title="Item unavailable"
						message="This item could not be loaded."
					/>
				) : null}
				{item.data !== undefined && (
					<StatusMessage tone="error">This item is not part of this page.</StatusMessage>
				)}
			</PluginScreenFrame>
		);
	}
	const schema = browse.find(
		({ slug, pluginId }) => slug === found.entitySchemaSlug && pluginId === found.ownerPluginId,
	);
	return (
		<PluginScreenFrame title={found.name} backLabel="All items">
			<div className="grid content-start gap-8">
				{chrome.compact ? null : (
					<div>
						<Button variant="ghost" onClick={chrome.back}>
							<AppIcon size={16} name="chevron-left" />
							All items
						</Button>
					</div>
				)}
				<EntityResults
					layout="list"
					references={references([found])}
					presentations={presentations([found])}
					viewContext={{ publication: publicationId }}
				/>
				<ItemDetails browse={schema} entityId={entityId} />
				<RelatedItems
					input={{ browse, schemas, entityId }}
					viewContext={{ publication: publicationId }}
				/>
			</div>
		</PluginScreenFrame>
	);
};
