import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import { decodePluginBackendFiles, pluginSourceHash } from "./pipeline";
import { fixtureManifest } from "./test-support";
import { PluginValidationError } from "./validation";

const encoder = new TextEncoder();

it("hashes sorted source paths and exact source bytes", () => {
	const manifest = fixtureManifest();
	const first = {
		"backend/a.ts": encoder.encode("same"),
		"client/image.png": new Uint8Array([0, 255, 1]),
	};
	const reordered = {
		"backend/a.ts": encoder.encode("same"),
		"client/image.png": new Uint8Array([0, 255, 1]),
	};
	const changed = { ...reordered, "client/image.png": new Uint8Array([0, 254, 1]) };

	expect(pluginSourceHash(manifest, first)).toBe(pluginSourceHash(manifest, reordered));
	expect(pluginSourceHash(manifest, changed)).not.toBe(pluginSourceHash(manifest, first));
});

it.effect("fatally rejects non-UTF-8 backend source before compilation", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const entry = manifest.scripts[0]?.entry;
		expect(entry).toBeDefined();
		if (!entry) {
			return;
		}
		const exit = yield* Effect.exit(decodePluginBackendFiles({ [entry]: new Uint8Array([0xff]) }));
		assertExitFails(
			exit,
			new PluginValidationError({ issues: ["Plugin backend source is not valid UTF-8"] }),
		);
	}),
);
