import { parse } from "@ryot/sandbox-sdk/papaparse";

export const parseCsvText = (text: string, delimiter = "") => {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (normalized.length === 0) {
		return { headers: [], rows: [] };
	}
	const result = parse<Record<string, string>>(normalized, {
		delimiter,
		header: true,
		skipEmptyLines: true,
		transform: (value) => value.trim(),
	});
	return { headers: result.meta.fields ?? [], rows: result.data };
};
