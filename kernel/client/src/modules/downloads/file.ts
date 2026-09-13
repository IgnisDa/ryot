import { Capacitor } from "@capacitor/core";
import { FileTransfer, type DownloadFileOptions } from "@capacitor/file-transfer";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Data, Effect, Option, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { Headers, HttpClientRequest } from "effect/unstable/http";

export type FileDownloadRequest = Pick<DownloadFileOptions, "url" | "headers"> & {
	readonly fileName: string;
};

export class FileDownloadError extends Data.TaggedError("FileDownloadError")<{
	readonly cause: unknown;
	readonly status?: number;
}> {}

const NativeHttpError = Schema.Struct({ data: Schema.Struct({ httpStatus: Schema.Finite }) });
const nativeError = (cause: unknown) => {
	const decoded = Schema.decodeUnknownOption(NativeHttpError)(cause);
	return new FileDownloadError({
		cause,
		...(Option.isSome(decoded) ? { status: decoded.value.data.httpStatus } : {}),
	});
};

export const makeNativeFileDownload = (ports: {
	readonly create: (path: string) => Effect.Effect<void, FileDownloadError>;
	readonly uri: (path: string) => Effect.Effect<string, FileDownloadError>;
	readonly transfer: (request: DownloadFileOptions) => Effect.Effect<void, FileDownloadError>;
	readonly share: (uri: string) => Effect.Effect<void, FileDownloadError>;
	readonly remove: (path: string) => Effect.Effect<void>;
}) =>
	Effect.fn("NativeFileDownload")(function* (request: FileDownloadRequest) {
		const directory = `ryot-download-${crypto.randomUUID()}`;
		const fileName = request.fileName.replace(/[\\/]/g, "_");
		yield* Effect.acquireRelease(ports.create(directory), () => ports.remove(directory));
		const uri = yield* ports.uri(`${directory}/${fileName}`);
		// Native plugins cannot abort transfers or share sheets; cleanup must wait for their completion.
		yield* ports
			.transfer({
				url: request.url,
				...(request.headers === undefined ? {} : { headers: request.headers }),
				path: uri,
				disableRedirects: true,
			})
			.pipe(Effect.uninterruptible);
		yield* ports.share(uri).pipe(
			Effect.catchIf(
				(error) =>
					typeof error.cause === "object" &&
					error.cause !== null &&
					"message" in error.cause &&
					error.cause.message === "Share canceled",
				() => Effect.void,
			),
			Effect.uninterruptible,
		);
	}, Effect.scoped);

const downloadNativeFile = makeNativeFileDownload({
	share: (uri) =>
		Effect.tryPromise({ catch: nativeError, try: () => Share.share({ files: [uri] }) }).pipe(
			Effect.asVoid,
		),
	transfer: (request) =>
		Effect.tryPromise({ catch: nativeError, try: () => FileTransfer.downloadFile(request) }).pipe(
			Effect.asVoid,
		),
	remove: (path) =>
		Effect.tryPromise(() =>
			Filesystem.rmdir({ path, recursive: true, directory: Directory.Cache }),
		).pipe(Effect.ignore),
	create: (path) =>
		Effect.tryPromise({
			catch: nativeError,
			try: () => Filesystem.mkdir({ path, directory: Directory.Cache }),
		}).pipe(Effect.asVoid),
	uri: (path) =>
		Effect.tryPromise({
			catch: nativeError,
			try: () => Filesystem.getUri({ path, directory: Directory.Cache }),
		}).pipe(Effect.map((result) => result.uri)),
});

export const downloadFile = Effect.fn("downloadFile")(function* (
	http: HttpClient.HttpClient,
	request: FileDownloadRequest,
) {
	if (Capacitor.isNativePlatform()) {
		yield* downloadNativeFile(request);
		return undefined;
	}
	const response = yield* http
		.execute(
			HttpClientRequest.get(request.url).pipe(HttpClientRequest.setHeaders(request.headers ?? {})),
		)
		.pipe(Effect.mapError((cause) => new FileDownloadError({ cause })));
	if (response.status < 200 || response.status >= 300) {
		return yield* new FileDownloadError({ cause: response.status, status: response.status });
	}
	const buffer = yield* response.arrayBuffer.pipe(
		Effect.mapError((cause) => new FileDownloadError({ cause })),
	);
	const contentType = Option.getOrElse(
		Headers.get(response.headers, "content-type"),
		() => "application/octet-stream",
	);
	return new Blob([buffer], { type: contentType });
});

export const saveDownloadedFile = (blob: Blob, fileName: string) => {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
};
