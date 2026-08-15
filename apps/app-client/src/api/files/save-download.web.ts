import {
	collectBoundedDownloadChunks,
	type DownloadWritable,
	type SaveDownloadInput,
	type SaveDownloadOutcome,
	type SaveDownloadTarget,
	writeDownloadChunks,
} from "./save-download-payload";

type SaveFileHandle = {
	readonly createWritable: () => Promise<DownloadWritable>;
};

type ShowSaveFilePicker = (options: {
	readonly suggestedName: string;
	readonly types: readonly {
		readonly description: string;
		readonly accept: Readonly<Record<string, readonly string[]>>;
	}[];
}) => Promise<SaveFileHandle>;

type BrowserDownloadEnvironment = {
	readonly showSaveFilePicker?: ShowSaveFilePicker;
	readonly downloadBlob: (blob: Blob, fileName: string) => void;
};

type SavePickerGlobal = typeof globalThis & {
	readonly showSaveFilePicker?: ShowSaveFilePicker;
};

const downloadBlob = (blob: Blob, fileName: string) => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.hidden = true;
	anchor.download = fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	// Some browsers start reading the blob after the click returns.
	setTimeout(() => URL.revokeObjectURL(url), 0);
};

const browserEnvironment = (): BrowserDownloadEnvironment => {
	const savePickerGlobal = globalThis as SavePickerGlobal;
	const showSaveFilePicker = savePickerGlobal.showSaveFilePicker;
	return {
		downloadBlob,
		showSaveFilePicker:
			typeof showSaveFilePicker === "function"
				? (options) => showSaveFilePicker.call(savePickerGlobal, options)
				: undefined,
	};
};

export const prepareBrowserDownload = async (
	input: Pick<SaveDownloadInput, "contentType" | "fileName">,
	environment: BrowserDownloadEnvironment,
): Promise<SaveDownloadTarget> => {
	if (environment.showSaveFilePicker === undefined) {
		return { kind: "fallback" };
	}
	const handle = await environment.showSaveFilePicker({
		suggestedName: input.fileName,
		types: [{ description: "Ryot backup", accept: { [input.contentType]: [".zip"] } }],
	});
	return { kind: "writable", createWritable: () => handle.createWritable() };
};

export const saveBrowserDownload = async (
	input: SaveDownloadInput,
	environment: BrowserDownloadEnvironment,
): Promise<SaveDownloadOutcome> => {
	if (input.target.kind === "writable") {
		const writable = await input.target.createWritable();
		try {
			await writeDownloadChunks(input.chunks, (chunk) => writable.write(chunk));
			await writable.close();
		} catch (error) {
			await writable.abort?.().catch(() => undefined);
			throw error;
		}
		return { kind: "saved" };
	}
	const chunks = await collectBoundedDownloadChunks(input);
	const parts = chunks.map(
		(chunk): Uint8Array<ArrayBuffer> =>
			chunk.buffer instanceof ArrayBuffer
				? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
				: new Uint8Array(chunk),
	);
	environment.downloadBlob(new Blob(parts, { type: input.contentType }), input.fileName);
	return { kind: "saved" };
};

export const prepareDownload = (input: Pick<SaveDownloadInput, "contentType" | "fileName">) =>
	prepareBrowserDownload(input, browserEnvironment());

export const pruneDownloadCache = () => undefined;

export const saveDownload = (input: SaveDownloadInput) =>
	saveBrowserDownload(input, browserEnvironment());
