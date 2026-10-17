import { deflateSync, inflateSync } from "@ryot-app/plugin-kit/compression";
import { Result, Schema } from "@ryot-app/plugin-kit/effect";

const decodedByteLimit = 128 * 1024;
const CompressedBytesSchema = Schema.Uint8ArrayFromBase64.check(
	Schema.makeFilter(
		(bytes) => bytes.byteLength <= 65536 || "Compressed editor value exceeds its byte limit",
	),
);

export const encodeWorkoutEditorJson = (json: string) => {
	const bytes = new TextEncoder().encode(json);
	if (bytes.byteLength > decodedByteLimit) {
		throw new Error("Workout editor value exceeds its decoded byte limit");
	}
	return Schema.encodeSync(CompressedBytesSchema)(deflateSync(bytes, { level: 9 }));
};

export const decodeWorkoutEditorJson = (value: unknown) => {
	const decoded = Schema.decodeUnknownResult(CompressedBytesSchema)(value);
	if (decoded._tag === "Failure") {
		return decoded;
	}
	try {
		const bytes = inflateSync(decoded.success, { out: new Uint8Array(decodedByteLimit + 1) });
		if (bytes.byteLength > decodedByteLimit) {
			return Result.fail(new Error("Workout editor value exceeds its decoded byte limit"));
		}
		return Result.succeed(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (error) {
		return Result.fail(error);
	}
};
