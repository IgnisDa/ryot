import type { SavedViewDisplayValue } from "@ryot-app/contract/modules/saved-views/schemas";

const formatJson = (value: unknown) => {
	const formatted: unknown = JSON.stringify(value);
	return typeof formatted === "string" ? formatted : "null";
};

export function formatSavedViewValue(value: SavedViewDisplayValue, locales?: Intl.LocalesArgument) {
	if (value.value === null) {
		return "";
	}
	if (value.displayKind === "text") {
		return value.value;
	}
	if (value.displayKind === "number") {
		return new Intl.NumberFormat(locales).format(value.value);
	}
	if (value.displayKind === "boolean") {
		return value.value ? "Yes" : "No";
	}
	if (value.displayKind === "json") {
		return formatJson(value.value);
	}
	return new Intl.DateTimeFormat(locales, { timeZone: "UTC" }).format(new Date(value.value));
}
