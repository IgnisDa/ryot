import { afterEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import spotify from "./spotify.sandbox";

const filesystemKey = Symbol.for("@ryot-app/sandbox-sdk/filesystem");

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

const extendedHistoryZip =
	"UEsDBBQAAAAIAIxDQV02fPRvoAAAAF0BAABEAAAAU3BvdGlmeSBFeHRlbmRlZCBTdHJlYW1pbmcgSGlzdG9yeS9TdHJlYW1pbmdfSGlzdG9yeV9BdWRpb18yMDIwLmpzb269jsEKwjAQRH9Fcq6wSdtLfsKDnhQJa5OWYLMpyYoU8d+Npafi2Tm+GYZ3eQnOQgsFCvYg96BOUGtoNLRnUYmQzTTi7KzQSrYNQCWSwxzJOCpMcMLubiO5ss1TZN/PZmHmkXzpV6YXpll+LzGzSyY4RouM65wwuLI/Rhp2h+XOUxcH8hxNiLZ0PY7ZvaufvhI0wMa3hpKNbv+0N6Z/uV4/UEsDBBQAAAAIAIxDQV34K7lHiAAAAK8AAABEAAAAU3BvdGlmeSBFeHRlbmRlZCBTdHJlYW1pbmcgSGlzdG9yeS9TdHJlYW1pbmdfSGlzdG9yeV9WaWRlb18yMDIxLmpzb24tzFsKgzAQheGtlHlWGIXeso361FLCYEYJNRlJphQp3Xuj+Pqfj/P4gmYw0GLb1His8dTh2eDF4PUOFYRs54kWdmAaRKwgMWWJlmMpoIn6l5PIReZZ1A+L3Zp9J1/2vZmtGW3XQ8rKyQZWcqS080iBi79JHA/dR4rzsZcxehUbxJVtoCnz7/kHUEsDBBQAAAAIAIxDQV0pBDTNEwAAABEAAABLAAAAU3BvdGlmeSBFeHRlbmRlZCBTdHJlYW1pbmcgSGlzdG9yeS9SZWFkTWVGaXJzdF9FeHRlbmRlZFN0cmVhbWluZ0hpc3RvcnkucGRmUw1wcdM11DNRyMsvUcgqzs8DAFBLAQIUABQAAAAIAIxDQV02fPRvoAAAAF0BAABEAAAAAAAAAAAAAAAAAAAAAABTcG90aWZ5IEV4dGVuZGVkIFN0cmVhbWluZyBIaXN0b3J5L1N0cmVhbWluZ19IaXN0b3J5X0F1ZGlvXzIwMjAuanNvblBLAQIUABQAAAAIAIxDQV34K7lHiAAAAK8AAABEAAAAAAAAAAAAAAAAAAIBAABTcG90aWZ5IEV4dGVuZGVkIFN0cmVhbWluZyBIaXN0b3J5L1N0cmVhbWluZ19IaXN0b3J5X1ZpZGVvXzIwMjEuanNvblBLAQIUABQAAAAIAIxDQV0pBDTNEwAAABEAAABLAAAAAAAAAAAAAAAAAOwBAABTcG90aWZ5IEV4dGVuZGVkIFN0cmVhbWluZyBIaXN0b3J5L1JlYWRNZUZpcnN0X0V4dGVuZGVkU3RyZWFtaW5nSGlzdG9yeS5wZGZQSwUGAAAAAAMAAwBdAQAAaAIAAAAA";

const accountDataZip =
	"UEsDBBQAAAAIAIxDQV1Dv6ajBAAAAAIAAAAiAAAAU3BvdGlmeSBBY2NvdW50IERhdGEvVXNlcmRhdGEuanNvbquuBQBQSwMEFAAAAAgAjENBXSm7TA0EAAAAAgAAACsAAABTcG90aWZ5IEFjY291bnQgRGF0YS9TdHJlYW1pbmdIaXN0b3J5MC5qc29ui44FAFBLAQIUABQAAAAIAIxDQV1Dv6ajBAAAAAIAAAAiAAAAAAAAAAAAAAAAAAAAAABTcG90aWZ5IEFjY291bnQgRGF0YS9Vc2VyZGF0YS5qc29uUEsBAhQAFAAAAAgAjENBXSm7TA0EAAAAAgAAACsAAAAAAAAAAAAAAAAARAAAAFNwb3RpZnkgQWNjb3VudCBEYXRhL1N0cmVhbWluZ0hpc3RvcnkwLmpzb25QSwUGAAAAAAIAAgCpAAAAkQAAAAAA";

const invalidJsonZip =
	"UEsDBBQAAAAIAIxDQV1my4zGCgAAAAgAAABEAAAAU3BvdGlmeSBFeHRlbmRlZCBTdHJlYW1pbmcgSGlzdG9yeS9TdHJlYW1pbmdfSGlzdG9yeV9BdWRpb18yMDIwLmpzb27Lyy9RyCrOzwMAUEsBAhQAFAAAAAgAjENBXWbLjMYKAAAACAAAAEQAAAAAAAAAAAAAAAAAAAAAAFNwb3RpZnkgRXh0ZW5kZWQgU3RyZWFtaW5nIEhpc3RvcnkvU3RyZWFtaW5nX0hpc3RvcnlfQXVkaW9fMjAyMC5qc29uUEsFBgAAAAABAAEAcgAAAGwAAAAAAA==";

const provideArtifact = (archive: string) => {
	const keys: string[] = [];
	Reflect.set(globalThis, filesystemKey, {
		writeScratchChunks: () => Promise.resolve(),
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			return Promise.resolve(Buffer.from(archive, "base64"));
		},
	});
	return keys;
};

it.live(
	"reads finished plays from the audio and video history files and ignores other entries",
	() =>
		Effect.gen(function* () {
			const keys = provideArtifact(extendedHistoryZip);

			const result = yield* spotify.run({ start: 0, limit: 25 });

			expect(keys).toEqual(["uploadToken"]);
			expect(result).toMatchObject({
				failures: [],
				totalItems: 2,
				entityGroups: [
					{ entityRef: { externalId: "t1" }, events: [{ occurredAt: "2020-01-02T03:04:05.000Z" }] },
					{ entityRef: { externalId: "t2" }, events: [{ occurredAt: "2021-05-06T07:08:09.000Z" }] },
				],
			});
			expect(result.entityGroups[0]?.events).toHaveLength(1);
		}),
);

it.live("rejects an archive without extended streaming history files", () =>
	Effect.gen(function* () {
		provideArtifact(accountDataZip);

		const error = yield* spotify.run({ start: 0, limit: 25 }).pipe(Effect.flip);

		expect(error.message).toBe(
			"No Spotify extended streaming history files were found in the archive. Request Extended streaming history, not Account data.",
		);
	}),
);

it.live("names the history file that is not valid JSON", () =>
	Effect.gen(function* () {
		provideArtifact(invalidJsonZip);

		const error = yield* spotify.run({ start: 0, limit: 25 }).pipe(Effect.flip);

		expect(error.message).toBe(
			"Spotify Extended Streaming History/Streaming_History_Audio_2020.json is not valid JSON",
		);
	}),
);
