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

export const parseCsvText = (
	text: string,
): { headers: string[]; rows: Record<string, string>[] } => {
	const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
	if (nonEmptyLines.length === 0) {
		return { headers: [], rows: [] };
	}

	const headerLine = nonEmptyLines[0];
	if (!headerLine) {
		return { headers: [], rows: [] };
	}
	const headers = parseCsvRow(headerLine);

	const rows: Record<string, string>[] = [];
	for (let i = 1; i < nonEmptyLines.length; i++) {
		const line = nonEmptyLines[i];
		if (!line) {
			continue;
		}
		const values = parseCsvRow(line);
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

const parseCsvRow = (line: string): string[] => {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			fields.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	fields.push(current.trim());
	return fields;
};
