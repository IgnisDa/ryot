import { BunServices } from "@effect/platform-bun";
import { layer } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/sandbox-sdk/core";
import { Cause, Effect, Option, type Scope, FileSystem, Path } from "effect";
import { assert, describe, expect, it as vitestIt } from "vitest";

import {
	decodeSandboxScratchManifest,
	measureSandboxScratchBytes,
	sandboxArtifactGrant,
	sandboxGrantPathError,
} from "./filesystem-grants";
import { selectSandboxHostFunctions } from "./service";

const unusedHostFunction = () => Effect.die("host function must not be called");

const withTempRoot = <A, E>(
	use: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-grants-" });
		return yield* use(root);
	});

describe("sandbox filesystem grant gating", () => {
	vitestIt("treats the capability as the gate and the dispatched path as its parameter", () => {
		expect(sandboxArtifactGrant(["artifact-read"], "/tmp/root/export.zip")).toBe(
			"/tmp/root/export.zip",
		);
		expect(sandboxArtifactGrant(["artifact-read"], undefined)).toBeUndefined();
		expect(sandboxArtifactGrant(["httpCall"], "/tmp/root/export.zip")).toBeUndefined();
		expect(sandboxArtifactGrant(["artifact-read"], { history: "/tmp/root/history" })).toEqual({
			history: "/tmp/root/history",
		});
	});

	vitestIt("never binds a host function for a filesystem grant capability", () => {
		const bound = { scratch: unusedHostFunction, httpCall: unusedHostFunction };

		expect(
			Object.keys(
				selectSandboxHostFunctions(bound, {
					principal: {
						contentHash: "",
						providerId: null,
						pluginRevision: null,
						scriptSlug: "script",
						subject: { type: "system" },
						scriptId: SandboxScriptId.make("script-1"),
						metadata: {
							kind: "script",
							runtimeImports: [],
							capabilities: ["scratch", "artifact-read", "httpCall"],
						},
					},
				}),
			),
		).toEqual(["httpCall"]);
		expect(SANDBOX_HOST_CAPABILITIES).toContain("scratch");
		expect(SANDBOX_HOST_CAPABILITIES).toContain("artifact-read");
	});
});

describe("sandbox grant path validation", () => {
	layer(BunServices.layer)((test) => {
		test.effect("rejects relative, traversing, and out-of-root paths", () =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const reject = (candidate: string) =>
					sandboxGrantPathError(path, "Sandbox artifact grant path", candidate, "/tmp/ryot-root");

				expect(reject("relative/export.zip")).toBe(
					"Sandbox artifact grant path must be an absolute path",
				);
				expect(reject("/tmp/ryot-root/../../etc/passwd")).toBe(
					"Sandbox artifact grant path must be a normalized path without traversal segments",
				);
				expect(reject("/etc/passwd")).toBe(
					"Sandbox artifact grant path must be inside /tmp/ryot-root",
				);
				expect(reject("/tmp/ryot-root-sibling/export.zip")).toBe(
					"Sandbox artifact grant path must be inside /tmp/ryot-root",
				);
				expect(reject("/tmp/ryot-root/nested/export.zip")).toBeNull();
			}),
		);
	});
});

describe("sandbox scratch measurement", () => {
	layer(BunServices.layer)((test) => {
		test.effect("sums regular files in the flat scratch directory", () =>
			withTempRoot((root) =>
				Effect.gen(function* () {
					const path = yield* Path.Path;
					const fs = yield* FileSystem.FileSystem;
					yield* fs.writeFile(path.join(root, "chunk-0.json"), new Uint8Array(1024));
					yield* fs.writeFile(path.join(root, "chunk-1.json"), new Uint8Array(2048));

					expect(yield* measureSandboxScratchBytes(root)).toBe(3072);
				}),
			),
		);

		test.effect("rejects directories and symbolic links", () =>
			withTempRoot((root) =>
				Effect.gen(function* () {
					const path = yield* Path.Path;
					const fs = yield* FileSystem.FileSystem;
					const nested = path.join(root, "nested");
					yield* fs.makeDirectory(nested);
					const directory = yield* Effect.exit(measureSandboxScratchBytes(root));
					assert(directory._tag === "Failure");
					expect(Cause.findErrorOption(directory.cause)).toEqual(
						Option.some(
							`Sandbox scratch entry "${nested}" must be a regular file (found Directory)`,
						),
					);
					yield* fs.remove(nested, { recursive: true });

					const link = path.join(root, "link");
					yield* fs.symlink(root, link);
					const symlinked = yield* Effect.exit(measureSandboxScratchBytes(root));
					assert(symlinked._tag === "Failure");
					expect(Cause.findErrorOption(symlinked.cause)).toEqual(
						Option.some(
							`Sandbox scratch entry "${link}" must be a regular file (found SymbolicLink)`,
						),
					);
				}),
			),
		);
	});
});

describe("sandbox scratch manifest", () => {
	vitestIt("harvests only when the returned value carries a chunk manifest", () => {
		expect(decodeSandboxScratchManifest({ groups: 12, chunkFiles: ["chunk-0.json"] })).toEqual(
			Option.some({ chunkFiles: ["chunk-0.json"] }),
		);
		expect(Option.isNone(decodeSandboxScratchManifest({ groups: 12 }))).toBe(true);
		expect(Option.isNone(decodeSandboxScratchManifest(null))).toBe(true);
	});
});
