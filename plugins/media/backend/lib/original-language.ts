import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { canonicalLanguageCode } from "@ryot-app/plugin-kit/languages";

import { canonicalTmdbLanguageCode } from "./vendors/tmdb-language";

export const originalLanguageProperties = (
	value: unknown,
	source: "tmdb" | "tvdb",
): Readonly<Record<string, JsonValue>> => {
	if (value === null || value === undefined) {
		return {};
	}
	if (typeof value !== "string") {
		throw new Error("Provider original language must be a language code");
	}
	if (value.trim() === "") {
		return {};
	}
	const code = source === "tmdb" ? canonicalTmdbLanguageCode(value) : canonicalLanguageCode(value);
	if (code === undefined) {
		throw new Error(`Provider original language is not recognized: ${value}`);
	}
	return { originalLanguage: code };
};
