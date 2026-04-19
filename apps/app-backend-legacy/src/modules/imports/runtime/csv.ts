import Papa from "papaparse";

export const normalizeCsvHeader = (value: string): string =>
	value.toLowerCase().replace(/[^a-z0-9]/g, "");

export const readCsvCell = (row: Record<string, string>, aliases: string[]): string | undefined => {
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
): string => {
	const value = readCsvCell(row, aliases);
	if (!value) {
		throw new Error(`Row is missing ${label}`);
	}
	return value;
};

export const readOptionalCsvNumber = (
	row: Record<string, string>,
	aliases: string[],
): number | undefined => {
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

export const parseCsvText = (
	text: string,
	delimiter?: string,
): { headers: string[]; rows: Record<string, string>[] } => {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (normalized.length === 0) {
		return { headers: [], rows: [] };
	}
	const result = Papa.parse<Record<string, string>>(normalized, {
		header: true,
		skipEmptyLines: true,
		delimiter: delimiter ?? "",
		transform: (value) => value.trim(),
	});
	const headers = result.meta.fields ?? [];
	return { headers, rows: result.data };
};
