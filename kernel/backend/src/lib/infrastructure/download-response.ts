import type { Stream } from "effect";
import { HttpServerResponse } from "effect/http";

const encodedFileName = (fileName: string) =>
	encodeURIComponent(fileName).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);

const fallbackFileName = (fileName: string) =>
	fileName.replace(/[\r\n"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");

export const streamDownloadResponse = (
	stream: Stream.Stream<Uint8Array, unknown>,
	input: {
		readonly fileName: string;
		readonly contentType: string;
		readonly contentLength?: number;
	},
) =>
	HttpServerResponse.stream(stream, {
		...(input.contentLength === undefined ? {} : { contentLength: input.contentLength }),
		headers: {
			"cache-control": "no-store",
			"content-type": input.contentType,
			"content-disposition": `attachment; filename="${fallbackFileName(input.fileName)}"; filename*=UTF-8''${encodedFileName(input.fileName)}`,
		},
	});
