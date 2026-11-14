import type { EntitySavedView } from "./runtime";

export function createSavedViewTableColumns(
	columns: EntitySavedView["displayConfiguration"]["table"]["columns"],
) {
	return columns.map((column, index) => ({
		fieldKey: `column_${index}`,
		label: column.label,
		width: Math.max(150, Math.min(240, column.label.trim().length * 10 + 72)),
	}));
}
