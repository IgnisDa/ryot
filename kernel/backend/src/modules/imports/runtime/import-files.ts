import { Effect } from "effect";

export const validateFileExtension = (
	fileName: string,
	allowedExtensions: string[],
): Effect.Effect<void, string> => {
	const segment = fileName.split(/[\\/]/).pop() ?? "";
	const dotIndex = segment.lastIndexOf(".");
	const ext = dotIndex > 0 ? segment.slice(dotIndex + 1).toLowerCase() : "";
	if (!allowedExtensions.includes(ext)) {
		return Effect.fail(
			`Import file must have one of the following extensions: ${allowedExtensions.join(", ")}`,
		);
	}
	return Effect.void;
};
