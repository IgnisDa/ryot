import { fieldSyncState, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import type {
	SavedViewCardMapping,
	SavedViewTableMapping,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type {
	SavedViewCardResultItem,
	SavedViewTableResultItem,
} from "@ryot-app/ryotql-recipes/saved-views";

export type SavedViewSyncSummary = {
	readonly populating: number;
	readonly translating: number;
};

export type SavedViewCardSlots = {
	readonly image: FieldSyncState;
	readonly callout: FieldSyncState;
	readonly overline: FieldSyncState;
	readonly primaryMetadata: FieldSyncState;
	readonly secondaryMetadata: FieldSyncState;
};

export type SavedViewSyncInput =
	| {
			readonly type: "card";
			readonly mapping: SavedViewCardMapping;
			readonly items: readonly SavedViewCardResultItem[];
	  }
	| {
			readonly type: "table";
			readonly mapping: SavedViewTableMapping;
			readonly items: readonly SavedViewTableResultItem[];
	  };

const slotState = (
	mapped: boolean,
	value: unknown,
	sync: SavedViewCardResultItem["sync"],
): FieldSyncState => (mapped ? fieldSyncState(value, sync) : "absent");

export const cardSyncSlots = (
	item: SavedViewCardResultItem,
	mapping: SavedViewCardMapping,
): SavedViewCardSlots => ({
	image: slotState(mapping.imageField !== null, item.image, item.sync),
	callout: slotState(mapping.callout !== null, item.callout, item.sync),
	overline: slotState(mapping.overline !== null, item.overline, item.sync),
	primaryMetadata: slotState(mapping.primaryMetadata !== null, item.primaryMetadata, item.sync),
	secondaryMetadata: slotState(
		mapping.secondaryMetadata !== null,
		item.secondaryMetadata,
		item.sync,
	),
});

export const tableImageSyncState = (
	item: SavedViewTableResultItem,
	mapping: SavedViewTableMapping,
) => slotState(mapping.imageField !== null, item.image, item.sync);

const populatingRows = (input: SavedViewSyncInput) => {
	if (input.type === "table") {
		return input.items.filter(
			(item) =>
				item.sync.populationStatus === "pending" &&
				(tableImageSyncState(item, input.mapping) === "pending" ||
					item.cells.some((cell) => cell.value.value === null)),
		).length;
	}
	return input.items.filter(
		(item) =>
			item.sync.populationStatus === "pending" &&
			Object.values(cardSyncSlots(item, input.mapping)).includes("pending"),
	).length;
};

export const savedViewSyncSummary = (input: SavedViewSyncInput): SavedViewSyncSummary => ({
	populating: populatingRows(input),
	translating: input.items.filter((item) => item.sync.translationStatus === "pending").length,
});
