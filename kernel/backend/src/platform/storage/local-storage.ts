import { BadRequest, badRequest } from "@ryot-app/contract/errors";
import { UPLOAD_MAX_FILE_BYTES } from "@ryot-app/contract/modules/assets/upload-policy";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Context, Effect, FileSystem, Layer, Path, PlatformError, Stream } from "effect";
import { SecureRandom } from "effect/crypto";

import { AppConfig } from "../config/service";
import { missingObject, writeFailed } from "./errors";
import { HmacSigner } from "./hmac-signer";

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const localUploadPath = (intentId: string) => `/uploads/local/${intentId}`;
const localDownloadPath = "/uploads/local/download";

const hasSystemErrorReason = (error: unknown, reason: "AlreadyExists") =>
	error instanceof PlatformError.PlatformError &&
	error.reason instanceof PlatformError.SystemError &&
	error.reason._tag === reason;

const isContained = (paths: Path.Path, root: string, target: string) => {
	const relative = paths.relative(root, target);
	return (
		relative.length > 0 &&
		relative !== ".." &&
		!relative.startsWith(`..${paths.sep}`) &&
		!paths.isAbsolute(relative)
	);
};

const rootsOverlap = (paths: Path.Path, first: string, second: string) =>
	first === second || isContained(paths, first, second) || isContained(paths, second, first);

const isLocalObjectKind = (value: string): value is "permanent" | "temporary" =>
	value === "permanent" || value === "temporary";

const invalidKey = () => badRequest(kernelMessage("error.storage.object-key-invalid"));
const invalidTarget = () => badRequest(kernelMessage("error.storage.target-invalid"));
const tooLarge = (maxBytes: number) =>
	badRequest(kernelMessage("error.storage.upload-too-large", { maxBytes }));

export class LocalStorageService extends Context.Service<LocalStorageService>()(
	"@ryot-app/kernel-backend/platform/storage/local-storage/LocalStorageService",
	{
		make: Effect.gen(function* () {
			const random = yield* SecureRandom.SecureRandom;
			const paths = yield* Path.Path;
			const config = yield* AppConfig;
			const signer = yield* HmacSigner;
			const fs = yield* FileSystem.FileSystem;
			const localDir = config.fileStorage.localDir;
			const localTempDir = config.fileStorage.localTempDir;
			const resolveRoot = (directory: string) =>
				Effect.gen(function* () {
					yield* fs.makeDirectory(directory, { recursive: true });
					const root = yield* fs.realPath(directory);
					const probe = yield* fs.makeTempDirectory({
						directory: root,
						prefix: ".ryot-write-test-",
					});
					yield* fs.remove(probe, { force: true, recursive: true });
					return root;
				});
			const permanentRoot = yield* resolveRoot(localDir).pipe(Effect.orDie);
			const temporaryRoot = yield* resolveRoot(localTempDir).pipe(Effect.orDie);
			if (rootsOverlap(paths, permanentRoot, temporaryRoot)) {
				return yield* Effect.die(
					"FILE_STORAGE_LOCAL_DIR and FILE_STORAGE_LOCAL_TEMP_DIR must not overlap.",
				);
			}

			const resolveRootForKey = (key: string) => {
				const namespace = key.split("/", 1)[0] ?? "";
				if (!isLocalObjectKind(namespace)) {
					return null;
				}
				return namespace === "permanent" ? permanentRoot : temporaryRoot;
			};

			const resolvePath = (key: string) =>
				Effect.gen(function* () {
					const root = resolveRootForKey(key);
					if (!root || !/^(?:permanent|temporary)\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key)) {
						return yield* invalidKey();
					}
					const target = paths.resolve(root, key);
					if (!isContained(paths, root, target)) {
						return yield* invalidKey();
					}
					yield* fs.makeDirectory(paths.dirname(target), { recursive: true }).pipe(Effect.orDie);
					const canonicalParent = yield* fs.realPath(paths.dirname(target)).pipe(Effect.orDie);
					if (!isContained(paths, root, canonicalParent)) {
						return yield* invalidKey();
					}
					if (yield* fs.exists(target)) {
						const canonicalTarget = yield* fs.realPath(target).pipe(Effect.orDie);
						if (!isContained(paths, root, canonicalTarget)) {
							return yield* invalidKey();
						}
					}
					return { root, target };
				});

			const sign = (method: string, pathname: string, expiresAt: number) =>
				signer.sign(`${method}\n${pathname}\n${expiresAt}`);

			const createUploadTarget = Effect.fn("LocalStorageService.createUploadTarget")(function* (
				intentId: string,
				now: number,
			) {
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
				const parsed = yield* Effect.try({
					catch: invalidTarget,
					try: () => new URL(url, "http://local.invalid"),
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
					expiresAt <= now ||
					!signature
				) {
					return yield* invalidTarget();
				}
				const valid = yield* signer.verify(
					`${method}\n${parsed.pathname}\n${expiresAt}`,
					signature,
				);
				if (!valid) {
					return yield* invalidTarget();
				}
				return void 0;
			});

			const createDownloadTarget = Effect.fn("LocalStorageService.createDownloadTarget")(function* (
				key: string,
				contentType: string,
				now: number,
			) {
				if (!key.startsWith("permanent/")) {
					return yield* invalidKey();
				}
				yield* resolvePath(key);
				const expiresAt = now + UPLOAD_URL_EXPIRY_SECONDS;
				const signature = yield* sign(
					"GET,HEAD",
					`${localDownloadPath}\n${key}\n${contentType}`,
					expiresAt,
				);
				const query = new URLSearchParams({
					key,
					signature,
					contentType,
					expires: String(expiresAt),
				});
				return `${localDownloadPath.slice(1)}?${query.toString()}`;
			});

			const verifyDownloadTarget = Effect.fn("LocalStorageService.verifyDownloadTarget")(function* (
				method: string,
				url: string,
				now: number,
			) {
				const parsed = yield* Effect.try({
					catch: invalidTarget,
					try: () => new URL(url, "http://local.invalid"),
				});
				const contentType = parsed.searchParams.get("contentType");
				const expiresValue = parsed.searchParams.get("expires");
				const expiresAt = Number(expiresValue);
				const key = parsed.searchParams.get("key");
				const signature = parsed.searchParams.get("signature");
				if (
					(method !== "GET" && method !== "HEAD") ||
					parsed.pathname !== localDownloadPath ||
					!contentType ||
					!key ||
					!expiresValue ||
					!/^[0-9]+$/.test(expiresValue) ||
					!Number.isSafeInteger(expiresAt) ||
					expiresAt <= now ||
					!signature
				) {
					return yield* invalidTarget();
				}
				const valid = yield* signer.verify(
					`GET,HEAD\n${parsed.pathname}\n${key}\n${contentType}\n${expiresAt}`,
					signature,
				);
				if (!valid) {
					return yield* invalidTarget();
				}
				return { key, contentType };
			});

			const existingPath = (key: string) =>
				Effect.gen(function* () {
					const { root, target } = yield* resolvePath(key);
					const canonicalTarget = yield* fs.realPath(target).pipe(Effect.mapError(missingObject));
					if (!isContained(paths, root, canonicalTarget)) {
						return yield* invalidKey();
					}
					return canonicalTarget;
				});

			const writeStagedObject = Effect.fn("LocalStorageService.writeStagedObject")(function* (
				key: string,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentLength: string | undefined,
				maxBytes: number = UPLOAD_MAX_FILE_BYTES,
			) {
				const { target } = yield* resolvePath(key);
				const declaredLength = contentLength === undefined ? null : Number(contentLength);
				if (
					declaredLength !== null &&
					(!Number.isSafeInteger(declaredLength) || declaredLength < 0)
				) {
					return yield* badRequest(kernelMessage("error.storage.content-length-invalid"));
				}
				if (declaredLength !== null && declaredLength > maxBytes) {
					return yield* tooLarge(maxBytes);
				}
				const staged = `${target}.${yield* random.uuidV4()}.part`;
				let size = 0;
				const bounded = stream.pipe(
					Stream.mapEffect((chunk) => {
						size += chunk.byteLength;
						return size > maxBytes ? Effect.fail(tooLarge(maxBytes)) : Effect.succeed(chunk);
					}),
				);
				yield* Stream.run(bounded, fs.sink(staged)).pipe(
					Effect.catch((error) =>
						fs
							.remove(staged, { force: true })
							.pipe(
								Effect.ignore,
								Effect.andThen(
									error instanceof BadRequest
										? Effect.fail(error)
										: Effect.logWarning("Local upload failed", error).pipe(
												Effect.andThen(Effect.fail(writeFailed())),
											),
								),
							),
					),
				);
				return { staged, target };
			});

			const writeObject = Effect.fn("LocalStorageService.writeObject")(function* (
				key: string,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentLength: string | undefined,
				maxBytes: number = UPLOAD_MAX_FILE_BYTES,
			) {
				const { staged, target } = yield* writeStagedObject(key, stream, contentLength, maxBytes);
				yield* fs.remove(target, { force: true }).pipe(Effect.orDie);
				yield* fs
					.rename(staged, target)
					.pipe(
						Effect.catch(() =>
							fs
								.remove(staged, { force: true })
								.pipe(Effect.ignore, Effect.andThen(Effect.fail(writeFailed()))),
						),
					);
				return void 0;
			});

			const writeObjectIfAbsent = Effect.fn("LocalStorageService.writeObjectIfAbsent")(function* (
				key: string,
				stream: Stream.Stream<Uint8Array, unknown>,
				contentLength: string | undefined,
				maxBytes: number = UPLOAD_MAX_FILE_BYTES,
			) {
				const { staged, target } = yield* writeStagedObject(key, stream, contentLength, maxBytes);
				return yield* fs.link(staged, target).pipe(
					Effect.as(true),
					Effect.catchIf(
						(error) => hasSystemErrorReason(error, "AlreadyExists"),
						() => Effect.succeed(false),
					),
					Effect.mapError(writeFailed),
					Effect.ensuring(fs.remove(staged, { force: true }).pipe(Effect.ignore)),
				);
			});

			const openObject = Effect.fn("LocalStorageService.openObject")(function* (key: string) {
				const target = yield* existingPath(key).pipe(Effect.mapError(missingObject));
				return fs.stream(target).pipe(Stream.mapError(missingObject));
			});

			const statObject = Effect.fn("LocalStorageService.statObject")(function* (key: string) {
				const target = yield* existingPath(key);
				return yield* fs.stat(target).pipe(Effect.mapError(missingObject));
			});

			const resolveObjectPath = Effect.fn("LocalStorageService.resolveObjectPath")(function* (
				key: string,
			) {
				return yield* existingPath(key);
			});

			const deleteObject = Effect.fn("LocalStorageService.deleteObject")(function* (key: string) {
				const { target } = yield* resolvePath(key);
				yield* fs.remove(target, { force: true }).pipe(Effect.orDie);
				yield* fs.remove(`${target}.part`, { force: true }).pipe(Effect.orDie);
			});

			return {
				openObject,
				statObject,
				writeObject,
				deleteObject,
				resolveObjectPath,
				createUploadTarget,
				verifyUploadTarget,
				writeObjectIfAbsent,
				createDownloadTarget,
				verifyDownloadTarget,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
