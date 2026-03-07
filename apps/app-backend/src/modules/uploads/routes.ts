import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { BadRequest, badRequest, dieOnDbError } from "@ryot/contract/errors";
import { Effect, FileSystem } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { UploadsService } from "./service";

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
	service: UploadsService["Service"],
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
	}).pipe(
		Effect.mapError((error) =>
			error instanceof BadRequest ? error : badRequest("Local file could not be served"),
		),
	);

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers
		.handle("createIntent", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.createUploadIntent(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("completeIntent", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.completeUploadIntent(user, params.intentId).pipe(dieOnDbError);
			}),
		)
		.handle("resolveDownloads", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.resolveDownloads(user, payload.assets).pipe(dieOnDbError);
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
					const service = yield* UploadsService;
					yield* service.putLocalIntent(
						params.intentId,
						request.method,
						request.url,
						request.headers["content-type"],
						request.headers["content-length"],
						request.stream,
					);
					return void 0;
				}),
			)
			.handleRaw("download", ({ request }) =>
				Effect.gen(function* () {
					const service = yield* UploadsService;
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
					const service = yield* UploadsService;
					return yield* localDownloadResponse(
						service,
						request.method,
						request.url,
						request.headers["range"],
					);
				}),
			),
);
