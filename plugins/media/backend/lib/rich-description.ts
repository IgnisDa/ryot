import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { normalizeMarkdown } from "@ryot-app/plugin-backend-sdk/markdown";

import { MediaSandboxError } from "./failures";

export const normalizeRichDescription = Effect.fn("normalizeRichDescription")(function* (
	input: unknown,
	baseUrl?: string,
): Effect.fn.Return<null | string, MediaSandboxError> {
	if (typeof input !== "string" || !input.trim()) {
		return null;
	}
	const normalized = yield* Effect.try({
		catch: () => new MediaSandboxError({ message: "description conversion failed" }),
		try: () => normalizeMarkdown(input.trim(), baseUrl === undefined ? undefined : { baseUrl }),
	});
	return normalized.trim() ? normalized : null;
});
