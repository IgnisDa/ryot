import type { EntityBrowserLayout } from "@ryot-app/contract/modules/saved-views/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ItemSelection } from "@ryot-app/plugin-ui-sdk";
import type { EntityBrowserResultItem } from "@ryot-app/ryotql-recipes/saved-views";

import { ManagedAssetProvider } from "../assets/provider";
import { EntityResults } from "../presentations/entity-results";
import type { EntitySettle } from "../refresh/settle";
import { managedCellAssets } from "./display-value";
import { type BrowserColumns, type BrowserItemActions, BrowserTable } from "./table";

export const browserResultEntries = (items: readonly EntityBrowserResultItem[]) => ({
	assets: items.flatMap((item) => managedCellAssets(item.cells)),
	presentations: new Map(
		items.flatMap(({ entityId, presentation }) =>
			presentation === null ? [] : [[entityId, presentation] as const],
		),
	),
	references: items.map((item) => ({
		name: item.name,
		entityId: item.entityId,
		ownerPluginId: item.ownerPluginId,
		entitySchemaSlug: item.entitySchemaSlug,
		...item.sync,
	})),
});

export function EntityBrowserResults({
	items,
	layout,
	columns,
	settled,
	selection,
	viewContext,
	renderItemActions,
	navigationEnabled = true,
}: {
	readonly settled: EntitySettle;
	readonly viewContext: JsonValue;
	readonly navigationEnabled?: boolean;
	readonly layout: EntityBrowserLayout;
	readonly columns: null | BrowserColumns;
	readonly selection: undefined | ItemSelection;
	readonly items: readonly EntityBrowserResultItem[];
	readonly renderItemActions?: undefined | BrowserItemActions;
}) {
	const { assets, references, presentations } = browserResultEntries(items);
	return (
		<ManagedAssetProvider assets={assets}>
			{layout === "table" ? (
				<BrowserTable
					items={items}
					settled={settled}
					columns={columns}
					selection={selection}
					navigationEnabled={navigationEnabled}
					renderItemActions={renderItemActions}
				/>
			) : (
				<EntityResults
					layout={layout}
					selection={selection}
					references={references}
					viewContext={viewContext}
					presentations={presentations}
					navigationEnabled={navigationEnabled}
					renderItemActions={renderItemActions}
				/>
			)}
		</ManagedAssetProvider>
	);
}
