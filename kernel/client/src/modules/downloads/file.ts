import { Capacitor } from "@capacitor/core";
import { FileTransfer, type DownloadFileOptions } from "@capacitor/file-transfer";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";

export type FileDownloadRequest = Pick<DownloadFileOptions, "url"> & { readonly fileName: string };

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
			.transfer({ path: uri, url: request.url, disableRedirects: true })
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

export const downloadFile = Effect.fn("downloadFile")(function* (request: FileDownloadRequest) {
	if (Capacitor.isNativePlatform()) {
		yield* downloadNativeFile(request);
		return;
	}
	yield* Effect.try({
		catch: (cause) => new FileDownloadError({ cause }),
		try: () => {
			const anchor = document.createElement("a");
			anchor.href = request.url;
			anchor.rel = "noreferrer";
			anchor.referrerPolicy = "no-referrer";
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
		},
	});
});

export class FileDownloads extends Context.Service<
	FileDownloads,
	{ readonly download: typeof downloadFile }
>()("FileDownloads", { make: Effect.succeed({ download: downloadFile }) }) {
	static readonly layer = Layer.effect(this, this.make);
}
