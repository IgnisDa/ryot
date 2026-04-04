import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { AppConfig } from "#lib/infrastructure/config/service";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { getSandboxAppConfigValue } from "./app-config";

const run = (
	key: string,
	isBuiltin: boolean,
	layer = makeAppConfigLayer(),
	requiredAppConfigKeys: ReadonlyArray<string> = [],
) =>
	Effect.runSync(
		Effect.gen(function* () {
			const config = yield* AppConfig;
			return yield* getSandboxAppConfigValue(config, key, {
				requiredAppConfigKeys,
				scriptIsBuiltin: isBuiltin,
			});
		}).pipe(Effect.either, Effect.provide(layer)),
	);

describe("getSandboxAppConfigValue", () => {
	it("returns the value for a non-sensitive top-level key", () => {
		const result = run("port", false);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe(3000);
		}
	});

	it("returns the value for a non-sensitive nested key", () => {
		const result = run("sandbox.denoDir", false);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("/tmp");
		}
	});

	it("fails for a key that does not exist in the meta", () => {
		const result = run("nonexistent.key", false);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toContain("does not exist");
		}
	});

	it("fails for a key with an empty segment", () => {
		const result = run(".invalid", false);
		expect(result._tag).toBe("Left");
	});

	it("fails for a key that resolves to a group, not a field", () => {
		const result = run("sandbox", false);
		expect(result._tag).toBe("Left");
	});

	it("fails for a sensitive key when the script is not builtin", () => {
		const result = run("sandbox.jobIdSecret", false);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toContain("sensitive");
		}
	});

	it("unwraps a Redacted value for a sensitive key when the script is builtin", () => {
		const result = run("sandbox.jobIdSecret", true);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("test-secret");
		}
	});

	it("unwraps a declared sensitive key for an installed plugin script", () => {
		const result = run("sandbox.jobIdSecret", false, makeAppConfigLayer(), ["sandbox.jobIdSecret"]);
		expect(result).toMatchObject({ _tag: "Right", right: "test-secret" });
	});

	it("fails when an optional key is not configured (Option.none)", () => {
		const result = run("server.corsOrigins", false);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toContain("not configured");
		}
	});

	it("returns the inner value when an optional key is configured (Option.some)", () => {
		const layer = makeAppConfigLayer({
			server: { corsOrigins: Option.some("http://localhost:3000") },
		});
		const result = run("server.corsOrigins", false, layer);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("http://localhost:3000");
		}
	});

	it("returns the plain string value for a non-sensitive non-secret key", () => {
		const result = run("timezone", false);
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("Etc/GMT");
		}
	});

	it("exposes the non-sensitive exercise preload limit to plugin scripts", () => {
		const layer = makeAppConfigLayer({ builtinExercisePreloadLimit: 321 });
		const pluginResult = run("builtinExercisePreloadLimit", false, layer);

		expect(pluginResult).toMatchObject({ _tag: "Right", right: 321 });
	});
});
