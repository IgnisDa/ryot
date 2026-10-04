import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

import {
	sidecarInboundFrames,
	sidecarOutboundFrames,
	type SidecarProtocolError,
} from "./sidecar-protocol";

const fixtureDirectory = new URL("../../../../../sandboxd/protocol-fixtures/", import.meta.url)
	.pathname;

const decodeIndex = Schema.decodeUnknownEffect(
	Schema.fromJsonString(
		Schema.Array(
			Schema.Struct({
				name: Schema.String,
				direction: Schema.Literals(["inbound", "outbound"]),
				expect: Schema.Literals(["valid", "payload", "framing"]),
			}),
		),
	),
);

const roundTrip = <Frame>(
	codec: {
		readonly encode: (frame: Frame) => Uint8Array;
		readonly decode: (bytes: Uint8Array) => Effect.Effect<Frame, SidecarProtocolError>;
	},
	bytes: Uint8Array,
) => codec.decode(bytes).pipe(Effect.map(codec.encode));

layer(BunFileSystem.layer)((test) => {
	test.effect("host_call_name_length_matches_utf16_on_both_sides", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const cases = [
				{ valid: true, value: "a".repeat(128), name: "host-call-name-ascii-128" },
				{ valid: false, value: "a".repeat(129), name: "host-call-name-ascii-129" },
				{ valid: true, value: "é".repeat(128), name: "host-call-name-bmp-128" },
				{ valid: false, value: "é".repeat(129), name: "host-call-name-bmp-129" },
				{ valid: true, value: "😀".repeat(64), name: "host-call-name-astral-64" },
				{ valid: false, value: "😀".repeat(65), name: "host-call-name-astral-65" },
			] as const;
			for (const fixture of cases) {
				const bytes = new Uint8Array(
					yield* fs.readFile(`${fixtureDirectory}${fixture.name}.frame`),
				);
				const result = yield* Effect.result(sidecarOutboundFrames.decode(bytes));
				if (fixture.valid) {
					assert(result._tag === "Success");
					assert(result.success.type === "hostCall");
					expect(result.success.name, fixture.name).toBe(fixture.value);
				} else {
					expect(result._tag === "Failure" && result.failure.reason, fixture.name).toBe("payload");
				}
			}
		}),
	);

	test.effect("decodes every fixture as indexed and re-encodes valid ones unchanged", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const fixtures = yield* decodeIndex(
				yield* fs.readFileString(`${fixtureDirectory}index.json`),
			);
			const files = yield* fs.readDirectory(fixtureDirectory);
			expect(files.filter((file) => file !== "index.json").sort()).toEqual(
				fixtures.map(({ name }) => `${name}.frame`).sort(),
			);
			for (const fixture of fixtures) {
				const bytes = new Uint8Array(
					yield* fs.readFile(`${fixtureDirectory}${fixture.name}.frame`),
				);
				const result = yield* Effect.result(
					fixture.direction === "inbound"
						? roundTrip(sidecarInboundFrames, bytes)
						: roundTrip(sidecarOutboundFrames, bytes),
				);
				if (fixture.expect === "valid") {
					expect(result._tag === "Success" && result.success, fixture.name).toEqual(bytes);
				} else {
					expect(result._tag === "Failure" && result.failure.reason, fixture.name).toBe(
						fixture.expect,
					);
				}
			}
		}),
	);
});
