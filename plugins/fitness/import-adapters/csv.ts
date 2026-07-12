import { parse } from "@ryot/sandbox-sdk/papaparse";

export const normalizeCsvHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export const readCsvCell = (row: Record<string, string>, aliases: string[]) => {
	const wanted = new Set(aliases.map(normalizeCsvHeader));
	for (const [key, value] of Object.entries(row)) {
		if (wanted.has(normalizeCsvHeader(key))) {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}
	}
	return undefined;
};

export const readRequiredCsvCell = (
	row: Record<string, string>,
	aliases: string[],
	label: string,
) => {
	const value = readCsvCell(row, aliases);
	if (!value) {
		throw new Error(`Row is missing ${label}`);
	}
	return value;
};

export const readOptionalCsvNumber = (row: Record<string, string>, aliases: string[]) => {
	const value = readCsvCell(row, aliases);
	if (!value) {
		return undefined;
	}
	const normalized = value.includes(".") ? value : value.replace(",", ".");
	const parsed = Number(normalized);
	if (Number.isNaN(parsed)) {
		throw new Error(`Could not parse numeric value "${value}"`);
	}
	return parsed;
};

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
