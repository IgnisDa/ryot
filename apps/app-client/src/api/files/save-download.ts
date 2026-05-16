import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { saveNativeDownload, shouldPruneTransferDirectory } from "./save-download-native";
import type { SaveDownloadInput, SaveDownloadOutcome } from "./save-download-payload";

const CACHE_DIRECTORY_PREFIX = "ryot-backup-transfer-";
let transferId = 0;
const activeTransferDirectories = new Set<string>();

const discard = (directory: Directory) => {
	try {
		if (directory.exists) {
			directory.delete();
		}
	} catch {
		return;
	}
};

export const pruneDownloadCache = () => {
	let entries: ReturnType<typeof Paths.cache.list>;
	try {
		entries = Paths.cache.list();
	} catch {
		return;
	}
	for (const entry of entries) {
		if (
			entry instanceof Directory &&
			shouldPruneTransferDirectory({
				uri: entry.uri,
				name: entry.name,
				prefix: CACHE_DIRECTORY_PREFIX,
				activeUris: activeTransferDirectories,
			})
		) {
			discard(entry);
		}
	}
};

export const prepareDownload = (_input?: Pick<SaveDownloadInput, "contentType" | "fileName">) => {
	pruneDownloadCache();
	return Promise.resolve({ kind: "native" } as const);
};

export const saveDownload = async (input: SaveDownloadInput): Promise<SaveDownloadOutcome> => {
	const directory = new Directory(
		Paths.cache,
		`${CACHE_DIRECTORY_PREFIX}${Date.now()}-${++transferId}`,
	);
	const file = new File(directory, input.fileName);
	activeTransferDirectories.add(directory.uri);
	try {
		directory.create();
		file.create();
		const outcome = await saveNativeDownload(input, {
			discard: () => discard(directory),
			sharingAvailable: Sharing.isAvailableAsync,
			open: () => {
				const handle = file.open(FileMode.WriteOnly);
				return { close: () => handle.close(), write: (chunk) => handle.writeBytes(chunk) };
			},
			share: () =>
				Sharing.shareAsync(file.uri, {
					mimeType: input.contentType,
					dialogTitle: `Save ${input.fileName}`,
				}),
		});
		if (outcome.kind === "failed") {
			activeTransferDirectories.delete(directory.uri);
		}
		// Keep this directory protected for the platform share lifetime; the recipient may read later.
		return outcome;
	} catch (error) {
		activeTransferDirectories.delete(directory.uri);
		discard(directory);
		throw error;
	}
};
