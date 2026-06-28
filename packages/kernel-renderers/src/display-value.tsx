import { useManagedAssetUrl } from "@ryot-app/client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import type { EntityBrowserResult } from "@ryot-app/ryotql-recipes/saved-views";

export type SavedViewCell = EntityBrowserResult["items"][number]["cells"][number];
export type SavedViewCellValue = SavedViewCell["value"];
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

export const cellText = (value: SavedViewCellValue): string => {
	if (value.value === null || value.displayKind === "managed-asset") {
		return "";
	}
	switch (value.displayKind) {
		case "boolean":
			return value.value ? "Yes" : "No";
		case "date":
			return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(new Date(value.value));
		case "number":
			return new Intl.NumberFormat().format(value.value);
		case "json":
			return JSON.stringify(value.value);
		case "text":
			return value.value;
	}
	return "";
};

export function CellThumbnail({
	asset,
	state,
	monogram,
	className,
}: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly asset: SavedViewCellAsset | undefined;
}) {
	const managed =
		asset === undefined || asset === null || asset.type === "remote" ? undefined : asset;
	const managedUrl = useManagedAssetUrl(managed);
	return (
		<EntityArtWell
			state={state}
			monogram={monogram}
			className={className}
			url={asset?.type === "remote" ? asset.url : managedUrl}
		/>
	);
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
	const content = cellText(value);
	return value.displayKind === "date" ? <time dateTime={value.value}>{content}</time> : content;
}
