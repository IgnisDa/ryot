const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

// Executable identities include the BOM and every original code point.
export const decodeExecutableText = (bytes: Uint8Array): string => decoder.decode(bytes);

export const encodeExecutableText = (text: string): Uint8Array => {
	const bytes = encoder.encode(text);
	if (decodeExecutableText(bytes) !== text) {
		throw new TypeError("Executable text cannot be encoded as exact UTF-8");
	}
	return bytes;
};
