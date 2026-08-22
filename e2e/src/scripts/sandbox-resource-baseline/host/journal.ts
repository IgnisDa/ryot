export const JOURNAL_MAX_LINES = 200;
export const JOURNAL_MAX_BYTES = 64 * 1024;

/** Keeps the earliest lines of the window because the first kernel warnings usually name the cause. */
export const boundJournal = (output: string) => {
	const all = output.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("-- "));
	const lines: Array<string> = [];
	let bytes = 0;
	for (const line of all) {
		const size = Buffer.byteLength(line, "utf8") + 1;
		if (lines.length >= JOURNAL_MAX_LINES || bytes + size > JOURNAL_MAX_BYTES) {
			break;
		}
		lines.push(line);
		bytes += size;
	}
	return { lines, lineCount: all.length, truncated: lines.length < all.length };
};
