import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { BadRequest } from "@ryot/contract/errors";
import { UploadBadRequest, UploadInternalError } from "@ryot/contract/modules/uploads/schemas";
import { Effect, FileSystem } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { UploadIntentsService } from "./intents/service";
import { ManagedAssetsService } from "./managed-assets/service";
import { ObjectStorageService } from "./object-storage/service";

const mapUploadError = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, UploadBadRequest | UploadInternalError, R> =>
	effect.pipe(
		Effect.catch((error): Effect.Effect<never, UploadBadRequest | UploadInternalError> => {
			const cause: unknown = error;
			if (cause instanceof UploadBadRequest) {
				return Effect.fail(cause);
			}
			if (cause instanceof BadRequest) {
				return Effect.fail(new UploadBadRequest({ reason: { code: "invalid-download-target" } }));
			}
			return Effect.logError("upload request failed", cause).pipe(
				Effect.andThen(new UploadInternalError({ reason: { code: "unexpected-error" } })),
			);
		}),
	);

const parseRange = (value: string | undefined, size: number) => {
	if (!value) {
		return { end: size - 1, start: 0 };
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || size === 0) {
		return null;
	}
	const [, startValue, endValue] = match;
	const start = startValue ? Number(startValue) : Math.max(0, size - Number(endValue));
	const end = endValue ? Number(endValue) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		end < start ||
		start >= size
	) {
		return null;
	}
	return { end: Math.min(end, size - 1), start };
};

const localDownloadResponse = (
	service: ObjectStorageService["Service"],
	method: string,
	url: string,
	range: string | undefined,
) =>
	Effect.gen(function* () {
		const file = yield* service.resolveLocalDownload(method, url);
		const parsedRange = parseRange(range, file.size);
		if (!parsedRange) {
			return HttpServerResponse.empty({
				headers: {
					"accept-ranges": "bytes",
					"content-range": `bytes */${file.size}`,
				},
				status: 416,
			});
		}
		const length = parsedRange.end - parsedRange.start + 1;
		const headers = {
			"accept-ranges": "bytes",
			"content-disposition": "inline",
			"content-type": file.contentType,
			"content-length": String(length),
			...(range
				? { "content-range": `bytes ${parsedRange.start}-${parsedRange.end}/${file.size}` }
				: {}),
		};
		if (method === "HEAD") {
			return HttpServerResponse.empty({
				headers,
				status: range ? 206 : 200,
			});
		}
		const fs = yield* FileSystem.FileSystem;
		return HttpServerResponse.stream(
			fs.stream(file.path, { offset: parsedRange.start, bytesToRead: length }),
			{
				headers,
				status: range ? 206 : 200,
			},
		);
	}).pipe(mapUploadError);

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers
		.handle("createIntent", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadIntentsService;
				return yield* service.createUploadIntent(user, payload).pipe(mapUploadError);
			}),
		)
		.handle("completeIntent", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadIntentsService;
				return yield* service.completeUploadIntent(user, params.intentId).pipe(mapUploadError);
			}),
		)
		.handle("resolveDownloads", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* ManagedAssetsService;
				return yield* service.resolveDownloads(user, payload.assets).pipe(mapUploadError);
			}),
		),
);

export const LocalUploadsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"localUploads",
	(handlers) =>
		handlers
			.handle("put", ({ params, request }) =>
				Effect.gen(function* () {
					const service = yield* UploadIntentsService;
					yield* service
						.putLocalIntent(
							params.intentId,
							request.method,
							request.url,
							request.headers["content-type"],
							request.headers["content-length"],
							request.stream,
						)
						.pipe(mapUploadError);
					return void 0;
				}),
			)
			.handleRaw("download", ({ request }) =>
				Effect.gen(function* () {
					const service = yield* ObjectStorageService;
					return yield* localDownloadResponse(
						service,
						request.method,
						request.url,
						request.headers["range"],
					);
				}),
			)
			.handleRaw("downloadHead", ({ request }) =>
				Effect.gen(function* () {
					const service = yield* ObjectStorageService;
					return yield* localDownloadResponse(
						service,
						request.method,
						request.url,
						request.headers["range"],
					);
				}),
			),
);
