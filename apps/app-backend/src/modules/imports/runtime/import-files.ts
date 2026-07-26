import { Effect } from "effect";

export const validateFileExtension = (
	filePath: string,
	allowedExtensions: string[],
): Effect.Effect<void, string> => {
	const segment = filePath.split(/[\\/]/).pop() ?? "";
	const dotIndex = segment.lastIndexOf(".");
	const ext = dotIndex > 0 ? segment.slice(dotIndex + 1).toLowerCase() : "";
	if (!allowedExtensions.includes(ext)) {
		return Effect.fail(
			`Import file must have one of the following extensions: ${allowedExtensions.join(", ")}`,
		);
	}
	return Effect.void;
};
