import type { SavedViewScalarValue } from "./display-data";

const formatJson = (value: unknown) => {
	try {
		return JSON.stringify(value) ?? "null";
	} catch {
		return "null";
	}
};

export function formatSavedViewValue(value: SavedViewScalarValue, locales?: Intl.LocalesArgument) {
	if (value.kind === "null") {
		return "";
	}
	if (value.kind === "text") {
		return value.value;
	}
	if (value.kind === "number") {
		return new Intl.NumberFormat(locales).format(value.value);
	}
	if (value.kind === "boolean") {
		return value.value ? "Yes" : "No";
	}
	if (value.kind === "json") {
		return formatJson(value.value);
	}
	const date = new Date(value.value);
	return Number.isNaN(date.getTime())
		? value.value
		: new Intl.DateTimeFormat(locales, { timeZone: "UTC" }).format(date);
}
