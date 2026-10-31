import { parse } from "@ryot-app/plugin-backend-sdk/papaparse";

export const parseCsvText = (text: string, delimiter = "") => {
	const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	if (normalized.length === 0) {
		return { rows: [], headers: [] };
	}
	const result = parse<Record<string, string>>(normalized, {
		delimiter,
		header: true,
		skipEmptyLines: true,
		transform: (value) => value.trim(),
	});
	return { rows: result.data, headers: result.meta.fields ?? [] };
};
