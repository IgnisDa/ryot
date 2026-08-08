import {
	type SaveDownloadInput,
	type SaveDownloadOutcome,
	writeDownloadChunks,
} from "./save-download-payload";

export const shouldPruneTransferDirectory = (input: {
	readonly uri: string;
	readonly name: string;
	readonly prefix: string;
	readonly activeUris: ReadonlySet<string>;
}) => input.name.startsWith(input.prefix) && !input.activeUris.has(input.uri);

export const saveNativeDownload = async (
	input: SaveDownloadInput,
	environment: {
		readonly discard: () => void;
		readonly share: () => Promise<void>;
		readonly sharingAvailable: () => Promise<boolean>;
		readonly open: () => {
			readonly close: () => void;
			readonly write: (chunk: Uint8Array) => void;
		};
	},
): Promise<SaveDownloadOutcome> => {
	try {
		const handle = environment.open();
		try {
			await writeDownloadChunks(input.chunks, (chunk) => handle.write(chunk));
		} finally {
			handle.close();
		}
		if (!(await environment.sharingAvailable())) {
			environment.discard();
			return { kind: "failed", message: "Saving files is not supported on this device." };
		}
		await environment.share();
		return { kind: "saved" };
	} catch (error) {
		environment.discard();
		throw error;
	}
};
