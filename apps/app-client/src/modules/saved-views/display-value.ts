import type { SavedViewScalarValue } from "./display-data";

const formatJson = (value: unknown) => {
	try {
		const formatted: unknown = JSON.stringify(value);
		return typeof formatted === "string" ? formatted : "null";
	} catch {
		return "null";
	}
};

export function formatSavedViewValue(value: SavedViewScalarValue, locales?: Intl.LocalesArgument) {
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
	const date = new Date(value.value);
	return Number.isNaN(date.getTime())
		? value.value
		: new Intl.DateTimeFormat(locales, { timeZone: "UTC" }).format(date);
}
