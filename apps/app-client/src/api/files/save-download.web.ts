import type { SaveDownloadInput, SaveDownloadOutcome } from "./save-download-payload";

const triggerBrowserDownload = (url: string, fileName: string) => {
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.hidden = true;
	anchor.rel = "noopener";
	anchor.target = "_blank";
	anchor.download = fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
};

export const pruneDownloadCache = () => undefined;

export const saveDownload = (input: SaveDownloadInput): Promise<SaveDownloadOutcome> => {
	triggerBrowserDownload(input.url, input.fileName);
	return Promise.resolve({ kind: "saved" });
};
