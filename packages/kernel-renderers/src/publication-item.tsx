import {
	BrowserInlineError,
	browserResultEntries,
	CellValue,
} from "@ryot-app/plugin-client-sdk/browser";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntityResults, usePluginChrome } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, Card, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { BrowseSchema } from "@ryot-app/ryotql-recipes/browse";
import {
	publicationBrowserSource,
	type PublicationItemDetail,
	publicationItemDetailsRecipe,
	publicationItemLinksRecipe,
	type PublicationSubjectSchema,
} from "@ryot-app/ryotql-recipes/publication-browse";
import {
	decodeEntityBrowserResult,
	type EntityBrowserResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";

type ItemsInput = {
	readonly entityIds: readonly string[];
	readonly browse: readonly BrowseSchema[];
	readonly schemas: readonly [PublicationSubjectSchema, ...PublicationSubjectSchema[]];
};

const itemsQuery = createRyotQuery<ItemsInput, readonly EntityBrowserResultItem[]>(
	({ input, client }) => {
		if (input.entityIds.length === 0) {
			return Effect.succeed([]);
		}
		const source = publicationBrowserSource(input.schemas);
		return client.data
			.execute(
				{
					arguments: { ids: input.entityIds },
					pages: { source: { limit: input.entityIds.length } },
					source: { kind: "inline", query: "source", document: source.dataSources },
				},
				(response) => decodeEntityBrowserResult(response, "source", source.settings),
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
	{ readonly entityId: string } & Parameters<typeof publicationItemDetailsRecipe>[0],
	readonly PublicationItemDetail[]
>(({ input, client }) =>
	input.fields.length === 0
		? Effect.succeed([])
		: client.data.query(publicationItemDetailsRecipe({ fields: input.fields }), {
				entityId: input.entityId,
			}),
);

const linksQuery = createRyotQuery<string, readonly string[]>(({ input, client }) =>
	client.data.query(publicationItemLinksRecipe, { entityId: input }),
);

const ItemResults = ({
	items,
	layout,
	publicationId,
}: {
	readonly publicationId: string;
	readonly layout: "grid" | "list";
	readonly items: readonly EntityBrowserResultItem[];
}) => {
	const { assets, references, presentations } = browserResultEntries(items);
	return (
		<ManagedAssetProvider assets={assets}>
			<EntityResults
				layout={layout}
				references={references}
				presentations={presentations}
				viewContext={{ publication: publicationId }}
			/>
		</ManagedAssetProvider>
	);
};

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
			<Card>
				<dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
					{details.data.map((detail) => (
						<div key={detail.key} className="contents">
							<dt className="text-xs font-medium tracking-wide text-text-muted uppercase sm:pt-0.5">
								{detail.label}
							</dt>
							<dd className="text-sm text-text">
								<CellValue value={detail.value} />
							</dd>
						</div>
					))}
				</dl>
			</Card>
		</section>
	);
};

const RelatedItems = ({
	input,
	publicationId,
}: {
	readonly publicationId: string;
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
			<ItemResults layout="grid" items={related.data} publicationId={publicationId} />
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
	readonly schemas: readonly [PublicationSubjectSchema, ...PublicationSubjectSchema[]];
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
				<ItemResults layout="list" items={[found]} publicationId={publicationId} />
				<ItemDetails browse={schema} entityId={entityId} />
				<RelatedItems publicationId={publicationId} input={{ browse, schemas, entityId }} />
			</div>
		</PluginScreenFrame>
	);
};
