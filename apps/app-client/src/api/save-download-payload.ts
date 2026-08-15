export type SaveDownloadOutcome =
	| { readonly kind: "saved" }
	| { readonly kind: "failed"; readonly message: string };

export type SaveDownloadInput = {
	readonly fileName: string;
	readonly contentType: string;
	readonly chunks: readonly Uint8Array[];
};

export const concatDownloadChunks = (chunks: readonly Uint8Array[]) => {
	const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
};
