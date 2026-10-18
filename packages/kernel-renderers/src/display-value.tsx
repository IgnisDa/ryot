import { useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import { displayValueText } from "@ryot-app/plugin-ui-sdk/table";
import type { EntityBrowserResult } from "@ryot-app/ryotql-recipes/saved-views";

export type SavedViewCellValue = SavedViewCell["value"];
export type SavedViewCell = EntityBrowserResult["items"][number]["cells"][number];
export type SavedViewCellAsset = Extract<
	SavedViewCellValue,
	{ readonly displayKind: "managed-asset" }
>["value"];

export const isAssetCell = (
	cell: SavedViewCell,
): cell is SavedViewCell & { readonly value: { readonly displayKind: "managed-asset" } } =>
	cell.value.displayKind === "managed-asset";

export const managedCellAssets = (cells: readonly SavedViewCell[]) =>
	cells.flatMap(({ value }) =>
		value.displayKind === "managed-asset" && value.value !== null && value.value.type !== "remote"
			? [value.value]
			: [],
	);

export function CellThumbnail({
	asset,
	state,
	monogram,
	className,
}: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly asset: undefined | SavedViewCellAsset;
}) {
	const url = useAssetUrl(asset ?? undefined);
	return <EntityArtWell url={url} state={state} monogram={monogram} className={className} />;
}

export function CellValue({
	value,
	monogram = "",
	state = "ready",
}: {
	readonly monogram?: string;
	readonly state?: FieldSyncState;
	readonly value: SavedViewCellValue;
}) {
	if (value.value === null) {
		return null;
	}
	if (value.displayKind === "managed-asset") {
		return (
			<CellThumbnail
				state={state}
				asset={value.value}
				monogram={monogram}
				className="size-10 shrink-0"
			/>
		);
	}
	const content = displayValueText(value);
	return value.displayKind === "date" ? <time dateTime={value.value}>{content}</time> : content;
}
