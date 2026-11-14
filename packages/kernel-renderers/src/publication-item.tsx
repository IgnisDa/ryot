import {
	BrowserInlineError,
	browserResultEntries,
	CellValue,
} from "@ryot-app/plugin-client-sdk/browser";
import { EntityResults, usePluginChrome } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotQuery,
	ManagedAssetProvider,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, Card, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	decodePublicationItem,
	type PublicationItemDetail,
	type PublicationItemDetailField,
} from "@ryot-app/ryotql-recipes/publication-browse";
import {
	decodeEntityBrowserResult,
	type EntityBrowserPageInput,
	type EntityBrowserResult,
	type EntityBrowserResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";

type ItemInput = {
	readonly entityId: string;
	readonly itemDetails: readonly PublicationItemDetailField[];
	readonly browser: typeof EntityBrowserPageInput.Type.settings;
};
const itemQuery = createRyotQuery<
	ItemInput,
	undefined | (EntityBrowserResultItem & { readonly details: readonly PublicationItemDetail[] })
>(({ input, client }) =>
	client.page.query("item", {
		arguments: { entityId: input.entityId },
		decode: (response) => decodePublicationItem(response, input.browser, input.itemDetails),
	}),
);
const linkedQuery = createRyotQuery<ItemInput, EntityBrowserResult>(({ input, client }) =>
	client.page.query("linked", {
		arguments: { entityId: input.entityId },
		decode: (response) => decodeEntityBrowserResult(response, "linked", input.browser),
	}),
);

export const PublicationResults = ({
	items,
	layout,
	publicationId,
	navigationEnabled = true,
}: {
	readonly publicationId: string;
	readonly layout: "grid" | "list";
	readonly navigationEnabled?: boolean;
	readonly items: readonly EntityBrowserResultItem[];
}) => {
	const { assets, references, presentations } = browserResultEntries(items);
	return (
		<ManagedAssetProvider assets={assets}>
			<EntityResults
				layout={layout}
				references={references}
				presentations={presentations}
				navigationEnabled={navigationEnabled}
				viewContext={{ publication: publicationId }}
			/>
		</ManagedAssetProvider>
	);
};

const ItemDetails = ({ details }: { readonly details: readonly PublicationItemDetail[] }) =>
	details.length === 0 ? null : (
		<section className="grid gap-3" aria-labelledby="publication-item-details">
			<h2 id="publication-item-details" className="text-sm font-semibold text-text">
				Details
			</h2>
			<Card>
				<dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
					{details.map((detail) => (
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

const RelatedItems = ({
	input,
	publicationId,
}: {
	readonly input: ItemInput;
	readonly publicationId: string;
}) => {
	const result = useRyotQuery(linkedQuery, input);
	if (result.isError) {
		return (
			<BrowserInlineError
				onRetry={result.refetch}
				title="Related items unavailable"
				message="The related published items could not be loaded."
			/>
		);
	}
	if (result.data === undefined || result.data.items.length === 0) {
		return null;
	}
	return (
		<section className="grid gap-3" aria-labelledby="publication-item-related">
			<h2 id="publication-item-related" className="text-sm font-semibold text-text">
				Related
			</h2>
			<PublicationResults layout="grid" items={result.data.items} publicationId={publicationId} />
		</section>
	);
};

export const PublicationItem = ({
	publicationId,
	...input
}: ItemInput & { readonly publicationId: string }) => {
	const chrome = usePluginChrome();
	const item = useRyotQuery(itemQuery, input);
	const found = item.data;
	if (found === undefined) {
		return (
			<PluginScreenFrame title="Item" backLabel="All items">
				{item.isError ? (
					<BrowserInlineError
						onRetry={item.refetch}
						title="Item unavailable"
						message="This item could not be loaded."
					/>
				) : null}
				{!item.isError && !item.isPending ? (
					<StatusMessage tone="error">This item is not part of this page.</StatusMessage>
				) : null}
			</PluginScreenFrame>
		);
	}
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
				<PublicationResults layout="list" items={[found]} publicationId={publicationId} />
				<ItemDetails details={found.details} />
				<RelatedItems input={input} publicationId={publicationId} />
			</div>
		</PluginScreenFrame>
	);
};
