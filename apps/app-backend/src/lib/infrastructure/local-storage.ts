import { BadRequest, badRequest } from "@ryot/contract/errors";
import { UPLOAD_MAX_FILE_BYTES } from "@ryot/contract/modules/uploads/upload-policy";
import { Context, Effect, FileSystem, Layer, Path, Redacted, Stream } from "effect";

import { AppConfig } from "./config/service";

export const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const localUploadPath = (intentId: string) => `/uploads/local/${intentId}`;

const base64UrlEncode = (bytes: Uint8Array) => {
	let value = "";
	for (const byte of bytes) {
		value += String.fromCharCode(byte);
	}
	return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const base64UrlDecode = (value: string) => {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		return null;
	}
	const padded = value
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	try {
		const decoded = atob(padded);
		return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
};

const isContained = (paths: Path.Path, root: string, target: string) => {
	const relative = paths.relative(root, target);
	return (
		relative.length > 0 &&
		relative !== ".." &&
		!relative.startsWith(`..${paths.sep}`) &&
		!paths.isAbsolute(relative)
	);
};

export class LocalStorageService extends Context.Service<LocalStorageService>()(
	"LocalStorageService",
	{
		make: Effect.gen(function* () {
			const paths = yield* Path.Path;
			const config = yield* AppConfig;
			const fs = yield* FileSystem.FileSystem;
			const localDir =
				config.fileStorage.localDir._tag === "Some" ? config.fileStorage.localDir.value : null;
			const signingSecret =
				config.fileStorage.localSigningSecret._tag === "Some"
					? Redacted.value(config.fileStorage.localSigningSecret.value)
					: null;
			const isConfigured =
				localDir !== null &&
				localDir.length > 0 &&
				signingSecret !== null &&
				signingSecret.length > 0;
			const signingKey = isConfigured
				? yield* Effect.tryPromise(() =>
						crypto.subtle.importKey(
							"raw",
							new TextEncoder().encode(signingSecret),
							{ name: "HMAC", hash: "SHA-256" },
							false,
							["sign", "verify"],
						),
					).pipe(Effect.orDie)
				: null;
			const storageRoot = isConfigured
				? yield* Effect.gen(function* () {
						yield* fs.makeDirectory(localDir, { recursive: true });
						const root = yield* fs.realPath(localDir);
						const probe = yield* fs.makeTempDirectory({
							directory: root,
							prefix: ".ryot-write-test-",
						});
						yield* fs.remove(probe, { recursive: true, force: true });
						return root;
					}).pipe(Effect.orDie)
				: null;

			const requireConfigured = Effect.suspend(() =>
				isConfigured
					? Effect.void
					: Effect.fail(
							badRequest(
								"Local file storage is not configured. Set FILE_STORAGE_LOCAL_DIR and FILE_STORAGE_LOCAL_SIGNING_SECRET.",
							),
						),
			);

			const resolvePath = (key: string) =>
				Effect.gen(function* () {
					yield* requireConfigured;
					if (!/^permanent\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key)) {
						return yield* badRequest("Local object key is invalid");
					}
					const root = storageRoot as string;
					const target = paths.resolve(root, key);
					if (!isContained(paths, root, target)) {
						return yield* badRequest(
							"Local object key is outside the configured storage directory",
						);
					}
					yield* fs.makeDirectory(paths.dirname(target), { recursive: true }).pipe(Effect.orDie);
					const canonicalParent = yield* fs.realPath(paths.dirname(target)).pipe(Effect.orDie);
					if (!isContained(paths, root, canonicalParent)) {
						return yield* badRequest(
							"Local object key resolves outside the configured storage directory",
						);
					}
					if (yield* fs.exists(target)) {
						const canonicalTarget = yield* fs.realPath(target).pipe(Effect.orDie);
						if (!isContained(paths, root, canonicalTarget)) {
							return yield* badRequest(
								"Local object key resolves outside the configured storage directory",
							);
						}
					}
					return target;
				});

			const sign = (method: string, pathname: string, expiresAt: number) =>
				Effect.tryPromise(() =>
					crypto.subtle.sign(
						"HMAC",
						signingKey as CryptoKey,
						new TextEncoder().encode(`${method}\n${pathname}\n${expiresAt}`),
					),
				).pipe(
					Effect.map((value) => base64UrlEncode(new Uint8Array(value))),
					Effect.orDie,
				);

			const createUploadTarget = Effect.fn("LocalStorageService.createUploadTarget")(function* (
				intentId: string,
				now: number,
			) {
				yield* requireConfigured;
				const expiresAt = now + UPLOAD_URL_EXPIRY_SECONDS;
				const pathname = localUploadPath(intentId);
				const signature = yield* sign("PUT", pathname, expiresAt);
				return {
					expiresAt,
					method: "PUT" as const,
					uploadUrl: `${pathname.slice(1)}?expires=${expiresAt}&signature=${signature}`,
				};
			});

			const verifyUploadTarget = Effect.fn("LocalStorageService.verifyUploadTarget")(function* (
				method: string,
				url: string,
				now: number,
			) {
				yield* requireConfigured;
				const parsed = yield* Effect.try({
					try: () => new URL(url, "http://local.invalid"),
					catch: () => badRequest("Local upload target is malformed"),
				});
				const expiresValue = parsed.searchParams.get("expires");
				const expiresAt = Number(expiresValue);
				const signature = parsed.searchParams.get("signature");
				if (
					method !== "PUT" ||
					!/^\/uploads\/local\/[A-Za-z0-9_-]+$/.test(parsed.pathname) ||
					!expiresValue ||
					!/^[0-9]+$/.test(expiresValue) ||
					!Number.isSafeInteger(expiresAt) ||
					expiresAt < now ||
					!signature
				) {
					return yield* badRequest("Local upload target is invalid or expired");
				}
				const actualBytes = base64UrlDecode(signature);
				if (actualBytes === null) {
					return yield* badRequest("Local upload target is invalid or expired");
				}
				const valid = yield* Effect.tryPromise(() =>
					crypto.subtle.verify(
						"HMAC",
						signingKey as CryptoKey,
						actualBytes,
						new TextEncoder().encode(`${method}\n${parsed.pathname}\n${expiresAt}`),
					),
				).pipe(Effect.orDie);
				if (!valid) {
					return yield* badRequest("Local upload target is invalid or expired");
				}
				return void 0;
			});

			const existingPath = (key: string) =>
				Effect.gen(function* () {
					const target = yield* resolvePath(key);
					const root = storageRoot as string;
					const canonicalTarget = yield* fs
						.realPath(target)
						.pipe(Effect.mapError(() => badRequest("Local upload object is missing or invalid")));
					if (!isContained(paths, root, canonicalTarget)) {
						return yield* badRequest(
							"Local object key resolves outside the configured storage directory",
						);
					}
					return canonicalTarget;
				});

			const writeObject = Effect.fn("LocalStorageService.writeObject")(function* (
				key: string,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentLength: string | undefined,
			) {
				const target = yield* resolvePath(key);
				const declaredLength = contentLength === undefined ? null : Number(contentLength);
				if (
					declaredLength !== null &&
					(!Number.isSafeInteger(declaredLength) || declaredLength < 0)
				) {
					return yield* badRequest("Content-Length is invalid");
				}
				if (declaredLength !== null && declaredLength > UPLOAD_MAX_FILE_BYTES) {
					return yield* badRequest(
						`Upload exceeds maximum allowed size of ${UPLOAD_MAX_FILE_BYTES} bytes`,
					);
				}
				const staged = `${target}.part`;
				yield* fs.remove(target, { force: true }).pipe(Effect.orDie);
				yield* fs.remove(staged, { force: true }).pipe(Effect.ignore);
				let size = 0;
				const bounded = stream.pipe(
					Stream.mapEffect((chunk) => {
						size += chunk.byteLength;
						return size > UPLOAD_MAX_FILE_BYTES
							? Effect.fail(
									badRequest(
										`Upload exceeds maximum allowed size of ${UPLOAD_MAX_FILE_BYTES} bytes`,
									),
								)
							: Effect.succeed(chunk);
					}),
				);
				yield* Stream.run(bounded, fs.sink(staged)).pipe(
					Effect.mapError((error) =>
						error instanceof Error ? badRequest(error.message) : badRequest("Local upload failed"),
					),
					Effect.catch((error) =>
						fs
							.remove(staged, { force: true })
							.pipe(
								Effect.ignore,
								Effect.andThen(
									Effect.fail(
										error instanceof BadRequest ? error : badRequest("Local upload failed"),
									),
								),
							),
					),
				);
				yield* fs.rename(staged, target).pipe(
					Effect.mapError(() => badRequest("Local upload could not be finalized")),
					Effect.catch((error) =>
						fs
							.remove(staged, { force: true })
							.pipe(
								Effect.ignore,
								Effect.andThen(
									Effect.fail(
										error instanceof BadRequest
											? error
											: badRequest("Local upload could not be finalized"),
									),
								),
							),
					),
				);
			});

			const statObject = Effect.fn("LocalStorageService.statObject")(function* (key: string) {
				const target = yield* existingPath(key);
				return yield* fs
					.stat(target)
					.pipe(Effect.mapError(() => badRequest("Local upload object is missing or invalid")));
			});

			const deleteObject = Effect.fn("LocalStorageService.deleteObject")(function* (key: string) {
				const target = yield* resolvePath(key);
				yield* fs.remove(target, { force: true }).pipe(Effect.orDie);
				yield* fs.remove(`${target}.part`, { force: true }).pipe(Effect.orDie);
			});

			return {
				statObject,
				writeObject,
				isConfigured,
				deleteObject,
				createUploadTarget,
				verifyUploadTarget,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
