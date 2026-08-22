import type { SaveDownloadInput, SaveDownloadOutcome } from "./save-download-payload";

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
		readonly download: (headers: Record<string, string>) => Promise<void>;
	},
): Promise<SaveDownloadOutcome> => {
	try {
		await environment.download(await input.headers());
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
