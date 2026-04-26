import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

export const getTemporaryDirectory = (): string => {
	const candidates = [Bun.env.TMPDIR, Bun.env.TMP, Bun.env.TEMP];
	const dir = candidates.find((v) => v && v.length > 0);
	return dir ?? "/tmp";
};

export const resolveSafeImportFilePath = (
	filePath: string,
	tempDir: string,
): { path: string } | { error: string } => {
	const normalizedTempDir = tempDir.replace(/[\\/]+$/, "");
	if (filePath.includes("..") || !filePath.startsWith(`${normalizedTempDir}/`)) {
		return { error: "Import file path must be inside the configured temporary upload directory" };
	}
	return { path: filePath };
};

export const validateFileExtension = (
	filePath: string,
	allowedExtensions: string[],
): { ok: true } | { error: string } => {
	const segment = filePath.split(/[\\/]/).pop() ?? "";
	const dotIndex = segment.lastIndexOf(".");
	const ext = dotIndex > 0 ? segment.slice(dotIndex + 1).toLowerCase() : "";
	if (!allowedExtensions.includes(ext)) {
		return {
			error: `Import file must have one of the following extensions: ${allowedExtensions.join(", ")}`,
		};
	}
	return { ok: true };
};

export const readImportFile = (safePath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.readFileString(safePath);
	});

export const cleanupImportFile = (safePath: string) =>
	Effect.gen(function* () {
		if (!safePath.trim()) {
			return;
		}
		const fs = yield* FileSystem.FileSystem;
		yield* fs.remove(safePath, { recursive: true }).pipe(Effect.ignore);
	});
