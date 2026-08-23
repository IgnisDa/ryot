import { parse } from "@ryot-app/sandbox-sdk/papaparse";

export const parseCsvText = (text: string, delimiter = "") => {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
