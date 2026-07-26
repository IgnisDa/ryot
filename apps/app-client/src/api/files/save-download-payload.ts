export const MAX_BUFFERED_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export type DownloadChunk = Uint8Array;

export type DownloadWritable = {
	readonly abort?: () => Promise<void>;
	readonly close: () => Promise<void>;
	readonly write: (chunk: DownloadChunk) => Promise<void>;
};

export type SaveDownloadTarget =
	| { readonly kind: "native" }
	| { readonly kind: "fallback" }
	| {
			readonly kind: "writable";
			readonly createWritable: () => Promise<DownloadWritable>;
	  };

export type SaveDownloadOutcome =
	| { readonly kind: "saved" }
	| { readonly kind: "failed"; readonly message: string };

export type SaveDownloadInput = {
	readonly fileName: string;
	readonly contentType: string;
	readonly contentLength?: number;
	readonly target: SaveDownloadTarget;
	readonly chunks: AsyncIterable<DownloadChunk>;
};

export class DownloadTooLargeError extends Error {
	readonly name = "DownloadTooLargeError";
}

export const writeDownloadChunks = async (
	chunks: AsyncIterable<DownloadChunk>,
	write: (chunk: DownloadChunk) => void | Promise<void>,
) => {
	for await (const chunk of chunks) {
		await write(chunk);
	}
};

export const collectBoundedDownloadChunks = async (input: {
	readonly maxBytes?: number;
	readonly contentLength?: number;
	readonly chunks: AsyncIterable<DownloadChunk>;
}) => {
	const maxBytes = input.maxBytes ?? MAX_BUFFERED_DOWNLOAD_BYTES;
	if (input.contentLength !== undefined && input.contentLength > maxBytes) {
		throw new DownloadTooLargeError(`Download exceeds ${maxBytes} bytes`);
	}
	let size = 0;
	const chunks: DownloadChunk[] = [];
	for await (const chunk of input.chunks) {
		size += chunk.byteLength;
		if (size > maxBytes) {
			throw new DownloadTooLargeError(`Download exceeds ${maxBytes} bytes`);
		}
		chunks.push(chunk);
	}
	return chunks;
};
