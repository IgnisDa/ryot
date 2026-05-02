import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { validateFileExtension } from "./import-files";

it.effect("validates case-insensitive extensions from original upload file names", () =>
	Effect.gen(function* () {
		yield* validateFileExtension("Goodreads Export.CSV", ["csv"]);
		const error = yield* Effect.flip(validateFileExtension("Goodreads Export.csv", ["json"]));
		expect(error).toBe("Import file must have one of the following extensions: json");
	}),
);
