import { BunServices } from "@effect/platform-bun";
import { it } from "@effect/vitest";
import { BadRequest } from "@ryot/contract/errors";
import { UPLOAD_MAX_FILE_BYTES } from "@ryot/contract/modules/uploads/upload-policy";
import { Effect, FileSystem, Layer, Option, Redacted, Stream } from "effect";
import { expect } from "vitest";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { LocalStorageService } from "./local-storage";

const key = "permanent/object.txt";
const ROOT = "/tmp/ryot-local-storage-test";
const TEMP_ROOT = "/tmp/ryot-local-storage-temp-test";

const makeLayer = () => {
	const platform = BunServices.layer;
	const localStorage = LocalStorageService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeAppConfigLayer({
					fileStorage: {
						localTempDir: TEMP_ROOT,
						localDir: Option.some(ROOT),
						localSigningSecret: Option.some(Redacted.make("local-test-secret")),
					},
				}),
				platform,
			),
		),
	);
	return Layer.merge(localStorage, platform);
};

it.effect("signs and validates local upload targets", () =>
	Effect.gen(function* () {
		const localStorage = yield* LocalStorageService;
		const target = yield* localStorage.createUploadTarget("intent-id", 1_700_000_000);

		yield* localStorage.verifyUploadTarget("PUT", target.uploadUrl, 1_700_000_899);
		const tampered = yield* Effect.exit(
			localStorage.verifyUploadTarget(
				"PUT",
				target.uploadUrl.replace("expires=1700000900", "expires=1700000901"),
				1_700_000_000,
			),
		);
		assertExitFails(
			tampered,
			new BadRequest({ message: "Local upload target is invalid or expired" }),
		);

		const wrongMethod = yield* Effect.exit(
			localStorage.verifyUploadTarget("POST", target.uploadUrl, 1_700_000_000),
		);
		assertExitFails(
			wrongMethod,
			new BadRequest({ message: "Local upload target is invalid or expired" }),
		);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("binds local download signatures to the key and content type", () =>
	Effect.gen(function* () {
		const localStorage = yield* LocalStorageService;
		const target = yield* localStorage.createDownloadTarget(key, "text/plain", 1_700_000_000);
		const verified = yield* localStorage.verifyDownloadTarget("GET", target, 1_700_000_899);
		expect(verified).toEqual({ contentType: "text/plain", key });
		const tampered = new URL(target, "http://local.invalid");
		tampered.searchParams.set("key", "permanent/other.txt");
		const exit = yield* Effect.exit(
			localStorage.verifyDownloadTarget("GET", tampered.toString(), 1_700_000_000),
		);
		assertExitFails(
			exit,
			new BadRequest({ message: "Local download target is invalid or expired" }),
		);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("streams local objects through a staged file and deletes them idempotently", () =>
	Effect.gen(function* () {
		const localStorage = yield* LocalStorageService;
		const body = new TextEncoder().encode("hello local storage");
		yield* localStorage.writeObject(key, Stream.make(body), String(body.byteLength));
		const info = yield* localStorage.statObject(key);
		expect(Number(info.size)).toBe(body.byteLength);
		yield* localStorage.deleteObject(key);
		yield* localStorage.deleteObject(key);
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("keeps temporary objects beneath the local working directory", () =>
	Effect.gen(function* () {
		const temporaryKey = "temporary/object.csv";
		const localStorage = yield* LocalStorageService;
		const body = new TextEncoder().encode("temporary data");
		yield* localStorage.writeObject(temporaryKey, Stream.make(body), String(body.byteLength));
		expect(yield* localStorage.resolveObjectPath(temporaryKey)).toMatch(
			/\/temporary\/object\.csv$/,
		);
		yield* localStorage.deleteObject(temporaryKey);
		expect(yield* Effect.exit(localStorage.statObject(temporaryKey))).toMatchObject({
			_tag: "Failure",
		});
	}).pipe(Effect.provide(makeLayer())),
);

it.effect(
	"rejects unsafe paths, oversized declarations, interrupted writes, and symlink escapes",
	() =>
		Effect.gen(function* () {
			const localStorage = yield* LocalStorageService;
			const fs = yield* FileSystem.FileSystem;
			const traversal = yield* Effect.exit(localStorage.statObject("permanent/../outside.txt"));
			assertExitFails(traversal, new BadRequest({ message: "Local object key is invalid" }));

			const oversized = yield* Effect.exit(
				localStorage.writeObject(key, Stream.empty, String(UPLOAD_MAX_FILE_BYTES + 1)),
			);
			assertExitFails(
				oversized,
				new BadRequest({
					message: `Upload exceeds maximum allowed size of ${UPLOAD_MAX_FILE_BYTES} bytes`,
				}),
			);

			const interrupted = yield* Effect.exit(
				localStorage.writeObject(
					key,
					Stream.concat(Stream.make(new Uint8Array([1])), Stream.fail("interrupted")),
					undefined,
				),
			);
			assertExitFails(interrupted, new BadRequest({ message: "Local upload failed" }));
			expect(yield* fs.exists(`${ROOT}/${key}`)).toBe(false);
			expect(yield* fs.exists(`${ROOT}/${key}.part`)).toBe(false);

			const outside = "/tmp/ryot-local-storage-outside";
			yield* fs.makeDirectory(outside, { recursive: true });
			yield* fs.remove(`${ROOT}/permanent`, { recursive: true, force: true });
			yield* fs.symlink(outside, `${ROOT}/permanent`);
			const escaped = yield* Effect.exit(
				localStorage.writeObject("permanent/escape.txt", Stream.make(new Uint8Array([1])), "1"),
			);
			assertExitFails(
				escaped,
				new BadRequest({
					message: "Local object key resolves outside the configured storage directory",
				}),
			);
			yield* fs.remove(`${ROOT}/permanent`, { force: true });
			yield* fs.remove(outside, { recursive: true, force: true });
		}).pipe(Effect.provide(makeLayer())),
);
