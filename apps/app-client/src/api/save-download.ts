import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import {
	concatDownloadChunks,
	type SaveDownloadInput,
	type SaveDownloadOutcome,
} from "./save-download-payload";

// Platform split: `expo-file-system` has no web support and `expo-sharing` cannot share
// local files by URI on web (the Web Share API has no desktop file support), so the OS
// hand-off is written once per platform. See `save-download.web.ts` for the browser path.

const SHARING_UNAVAILABLE_MESSAGE = "Saving files is not supported on this device.";

const discard = (file: File) => {
	if (file.exists) {
		file.delete();
	}
};

export const saveDownload = async (input: SaveDownloadInput): Promise<SaveDownloadOutcome> => {
	const file = new File(Paths.cache, input.fileName);
	try {
		file.create({ overwrite: true });
		file.write(concatDownloadChunks(input.chunks));
		if (!(await Sharing.isAvailableAsync())) {
			discard(file);
			return { kind: "failed", message: SHARING_UNAVAILABLE_MESSAGE };
		}
		await Sharing.shareAsync(file.uri, {
			mimeType: input.contentType,
			dialogTitle: `Save ${input.fileName}`,
		});
	} catch (error) {
		discard(file);
		throw error;
	}
	// Kept after a successful share: the receiving app may still be reading the granted URI, and
	// deleting here truncates large archives. It lives in the app-private cache the OS reclaims,
	// and a later download of the same run overwrites it.
	return { kind: "saved" };
};
