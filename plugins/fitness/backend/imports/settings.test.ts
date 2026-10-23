import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { installSandboxTestFilesystem } from "@ryot-app/plugin-backend-sdk/testing";
import { afterEach, expect, it } from "vitest";

import settingsScript from "./settings.sandbox";

afterEach(() => installSandboxTestFilesystem(undefined));

const installSettings = (settings: string) => {
	const bytes = new TextEncoder().encode(settings);
	installSandboxTestFilesystem({
		readArtifact: () => Promise.reject(new Error("Unexpected full artifact read")),
		writeScratchChunks: () => Promise.reject(new Error("Unexpected scratch write")),
		readNamedArtifact: () => Promise.reject(new Error("Unexpected full artifact read")),
		readArtifactRange: (offset, length) =>
			Promise.resolve({ size: bytes.length, bytes: bytes.slice(offset, offset + length) }),
	});
};

it("reads the admitted OpenScale export timezone without a host timezone default", () => {
	installSettings('{"timezone":" Asia/Kolkata "}');
	return Effect.runPromise(
		settingsScript.run({ artifactHandle: "admitted-settings" }).pipe(
			Effect.map((settings) => {
				expect(settings).toEqual({ timezone: "Asia/Kolkata" });
			}),
		),
	);
});

it.each(["{}", '{"timezone":""}', '{"timezone":"  "}', '{"timezone":null}'])(
	"rejects missing or empty OpenScale timezone in admitted settings %s",
	(settings) => {
		installSettings(settings);
		return expect(
			Effect.runPromise(settingsScript.run({ artifactHandle: "admitted-settings" })),
		).rejects.toThrow("Import job is missing timezone");
	},
);
