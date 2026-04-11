import node_path from "node:path";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const resolveSafeImportFilePath = (
	filePath: string,
	tempDir: string,
): { path: string } | { error: string } => {
	const normalizedTempDir = node_path.resolve(tempDir);
	const resolvedPath = node_path.resolve(filePath);

	if (!resolvedPath.startsWith(normalizedTempDir + node_path.sep)) {
		return { error: "Import file path must be inside the configured temporary upload directory" };
	}

	return { path: resolvedPath };
};

export const validateFileExtension = (
	filePath: string,
	allowedExtensions: string[],
): { ok: true } | { error: string } => {
	const ext = node_path.extname(filePath).toLowerCase().replace(/^\./, "");
	if (!allowedExtensions.includes(ext)) {
		return {
			error: `Import file must have one of the following extensions: ${allowedExtensions.join(", ")}`,
		};
	}
	return { ok: true };
};

export const readImportFile = async (
	safePath: string,
	maxBytes = MAX_FILE_BYTES,
): Promise<string> => {
	const file = Bun.file(safePath);
	const size = file.size;
	if (size > maxBytes) {
		throw new Error(
			`Import file exceeds maximum allowed size of ${maxBytes} bytes (file is ${size} bytes)`,
		);
	}
	return file.text();
};

export const cleanupImportFile = async (safePath: string): Promise<void> => {
	try {
		await Bun.file(safePath).delete();
	} catch (error) {
		console.warn(`Import file cleanup failed for path '${safePath}':`, error);
	}
};

/**
 * Detects the CSV delimiter by scanning the first record (up to the first
 * unquoted newline). Quote-aware so commas inside quoted headers do not
 * trigger false semicolon detection.
 */
const detectCsvDelimiter = (text: string, hint?: string): string => {
	if (hint) {
		return hint;
	}
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (!inQuotes && char === "\n") {
			break;
		} else if (!inQuotes && char === ";") {
			return ";";
		}
	}
	return ",";
};

/**
 * Parses CSV text using a full-text state machine that correctly handles
 * quoted fields containing embedded newlines (RFC 4180). Records where all
 * fields are empty are skipped (equivalent to blank-line filtering).
 */
export const parseCsvText = (
	text: string,
	delimiter?: string,
): { headers: string[]; rows: Record<string, string>[] } => {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (normalized.length === 0) {
		return { headers: [], rows: [] };
	}

	const resolvedDelimiter = detectCsvDelimiter(normalized, delimiter);
	const records: string[][] = [];
	let currentField = "";
	let currentRecord: string[] = [];
	let inQuotes = false;

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];
		if (char === '"') {
			if (inQuotes && normalized[i + 1] === '"') {
				currentField += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (!inQuotes && char === resolvedDelimiter) {
			currentRecord.push(currentField.trim());
			currentField = "";
		} else if (!inQuotes && char === "\n") {
			currentRecord.push(currentField.trim());
			currentField = "";
			if (currentRecord.some((f) => f.length > 0)) {
				records.push(currentRecord);
			}
			currentRecord = [];
		} else {
			currentField += char;
		}
	}

	// Flush any trailing content that has no final newline.
	currentRecord.push(currentField.trim());
	if (currentRecord.some((f) => f.length > 0)) {
		records.push(currentRecord);
	}

	if (records.length === 0) {
		return { headers: [], rows: [] };
	}

	const headers = records[0] ?? [];
	const rows: Record<string, string>[] = [];
	for (let i = 1; i < records.length; i++) {
		const values = records[i] ?? [];
		const row: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			const header = headers[j];
			if (header !== undefined) {
				row[header] = values[j] ?? "";
			}
		}
		rows.push(row);
	}

	return { headers, rows };
};
