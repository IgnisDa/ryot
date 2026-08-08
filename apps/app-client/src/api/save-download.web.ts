import {
	concatDownloadChunks,
	type SaveDownloadInput,
	type SaveDownloadOutcome,
} from "./save-download-payload";

// Platform split: `expo-sharing` cannot share local files by URI on web and requires HTTPS,
// while the Web Share API has no file support in desktop Chrome or Firefox, and
// `expo-file-system` has no web support at all. See `save-download.ts` for the native path.

export const saveDownload = (input: SaveDownloadInput): Promise<SaveDownloadOutcome> => {
	const url = URL.createObjectURL(
		new Blob([concatDownloadChunks(input.chunks)], { type: input.contentType }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.hidden = true;
	anchor.download = input.fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	// Revoked on the next macrotask: some browsers read the blob after the click returns, and
	// revoking synchronously truncates the download.
	setTimeout(() => URL.revokeObjectURL(url), 0);
	return Promise.resolve({ kind: "saved" });
};
