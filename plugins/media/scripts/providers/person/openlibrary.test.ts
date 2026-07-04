import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./openlibrary.sandbox";

type OpenLibraryPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (httpCall: OpenLibraryPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.openlibrary sandbox script", () => {
	it("collects deduplicated alternate names, website, bio and dates", () => {
		const host = makeHost(() =>
			httpSuccess({
				birth_date: "1970",
				death_date: "2020",
				name: "Author Name",
				bio: { value: "Bio." },
				personal_name: "A. Name",
				links: [{ url: "https://a.example" }],
				alternate_names: ["Alt One", "Author Name"],
			}),
		);

		return runSandboxTestDriver(details, { externalId: "OL1A" }, host, execution).pipe(
			Effect.map((result) => {
				expect(result.name).toBe("Author Name");
				expect(result.properties).toEqual({
					images: [],
					birthDate: "1970",
					deathDate: "2020",
					description: "Bio.",
					website: "https://a.example",
					sourceUrl: "https://openlibrary.org/authors/OL1A",
					alternateNames: ["A. Name", "Alt One", "Author Name"],
				});
				return undefined;
			}),
			Effect.runPromise,
		);
	});

	it("throws when the author payload has no name", () => {
		const host = makeHost(() => httpSuccess({ bio: "Bio." }));

		return expect(
			Effect.runPromise(runSandboxTestDriver(details, { externalId: "OL1A" }, host, execution)),
		).rejects.toThrow("OpenLibrary author payload is missing name");
	});
});
