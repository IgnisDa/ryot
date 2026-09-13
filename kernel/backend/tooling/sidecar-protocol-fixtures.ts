#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Data, Effect, FileSystem, Path } from "effect";

import {
	SIDECAR_PROTOCOL_LIMITS,
	type SidecarInboundFrame,
	sidecarInboundFrames,
	type SidecarOutboundFrame,
	sidecarOutboundFrames,
} from "../src/lib/infrastructure/sandbox-runtime/sidecar-protocol";

class FixtureError extends Data.TaggedError("FixtureError")<{ message: string }> {}

type Expectation = "framing" | "payload" | "valid";
type Direction = "inbound" | "outbound";
type Fixture = { name: string; bytes: Uint8Array; expect: Expectation; direction: Direction };

const MiB = 1024 * 1024;
const sha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const limits = { cpuMs: 2_000, deadlineMs: 30_000, heapBytes: 64 * MiB, externalBytes: 16 * MiB };
const envelope = { seq: 0, generation: 7, handle: "exec-1" };
const usage = { externalBytes: 0, heapBytes: 12 * MiB };
const run = {
	...envelope,
	limits,
	type: "run",
	tier: "core",
	lane: "interactive",
	input: { page: 1, query: "dune", flags: [true, null] },
	module: { sha256, source: "export default (input) => input;" },
} satisfies SidecarInboundFrame;

const inbound = (name: string, frame: SidecarInboundFrame): Fixture => ({
	name,
	expect: "valid",
	direction: "inbound",
	bytes: sidecarInboundFrames.encode(frame),
});

const outbound = (name: string, frame: SidecarOutboundFrame): Fixture => ({
	name,
	expect: "valid",
	direction: "outbound",
	bytes: sidecarOutboundFrames.encode(frame),
});

const framed = (payload: Uint8Array, declaredLength = payload.byteLength) => {
	const bytes = new Uint8Array(4 + payload.byteLength);
	new DataView(bytes.buffer).setUint32(0, declaredLength);
	bytes.set(payload, 4);
	return bytes;
};

const invalid = (
	name: string,
	direction: Direction,
	expect: Exclude<Expectation, "valid">,
	bytes: Uint8Array,
): Fixture => ({ name, bytes, expect, direction });

const invalidPayload = (name: string, direction: Direction, value: unknown) =>
	invalid(name, direction, "payload", framed(new TextEncoder().encode(JSON.stringify(value))));

const fixtures: ReadonlyArray<Fixture> = [
	inbound("run", run),
	inbound("run-full-background", { ...run, input: null, tier: "full", lane: "background" }),
	inbound("host-result-success", {
		...envelope,
		seq: 1,
		type: "hostResult",
		result: { status: "success", value: { body: "ok", status: 200 } },
	}),
	inbound("host-result-failure", {
		...envelope,
		seq: 2,
		type: "hostResult",
		result: { status: "failure", message: "host function is not allowed" },
	}),
	inbound("cancel", { ...envelope, type: "cancel" }),
	inbound("part-run", {
		...envelope,
		count: 2,
		index: 0,
		type: "part",
		frameType: "run",
		data: "eyJzZXEiOjA=",
		byteLength: SIDECAR_PROTOCOL_LIMITS.partBytes + 1,
	}),
	outbound("ready", { generation: 7, type: "ready" }),
	outbound("host-call", {
		...envelope,
		seq: 1,
		type: "hostCall",
		name: "httpCall",
		args: ["GET", "https://example.com", {}],
	}),
	outbound("host-call-name-ascii-128", {
		...envelope,
		args: null,
		type: "hostCall",
		name: "a".repeat(128),
	}),
	outbound("host-call-name-bmp-128", {
		...envelope,
		args: null,
		type: "hostCall",
		name: "é".repeat(128),
	}),
	outbound("host-call-name-astral-64", {
		...envelope,
		args: null,
		type: "hostCall",
		name: "😀".repeat(64),
	}),
	outbound("done-completed", {
		...envelope,
		usage,
		type: "done",
		outcome: { status: "completed", value: { items: [1, 2, 3] } },
		console: {
			truncated: false,
			entries: [
				{ level: "log", message: "started" },
				{ level: "error", message: "retrying" },
			],
		},
	}),
	outbound("done-failed", {
		...envelope,
		usage,
		type: "done",
		console: { entries: [], truncated: true },
		outcome: { status: "failed", phase: "resolution", message: "import not allowed: node:fs" },
	}),
	outbound("done-limit", {
		...envelope,
		usage,
		type: "done",
		console: { entries: [], truncated: false },
		outcome: { limit: "cpu", status: "limit", message: "CPU limit of 2000 ms exceeded" },
	}),
	outbound("done-cancelled", {
		...envelope,
		usage,
		type: "done",
		outcome: { status: "cancelled" },
		console: { entries: [], truncated: false },
	}),
	outbound("draining", { generation: 7, type: "draining", reason: "executions" }),
	outbound("fatal", {
		generation: 7,
		type: "fatal",
		handle: "exec-1",
		reason: "termination-ignored",
	}),
	outbound("part-done", {
		...envelope,
		count: 3,
		index: 2,
		type: "part",
		data: "fX0=",
		frameType: "done",
		byteLength: 2 * SIDECAR_PROTOCOL_LIMITS.partBytes + 2,
	}),
	invalidPayload("run-bad-sha256", "inbound", { ...run, module: { ...run.module, sha256: "x" } }),
	invalidPayload("run-heap-below-minimum", "inbound", {
		...run,
		limits: { ...limits, heapBytes: MiB },
	}),
	invalidPayload("run-unknown-tier", "inbound", { ...run, tier: "kernel" }),
	invalidPayload("run-excess-property", "inbound", { ...run, grant: "/etc" }),
	invalidPayload("run-missing-handle", "inbound", { ...run, handle: undefined }),
	invalidPayload("cancel-handle-shape", "inbound", {
		...envelope,
		type: "cancel",
		handle: "../exec",
	}),
	invalidPayload("host-result-unknown-status", "inbound", {
		...envelope,
		type: "hostResult",
		result: { status: "maybe" },
	}),
	invalidPayload("unknown-type", "inbound", { ...envelope, type: "shutdown" }),
	invalidPayload("part-bad-base64", "inbound", {
		...envelope,
		count: 2,
		index: 0,
		data: "%%%",
		type: "part",
		byteLength: 10,
		frameType: "run",
	}),
	invalidPayload("host-call-empty-name", "outbound", {
		...envelope,
		name: "",
		args: null,
		type: "hostCall",
	}),
	invalidPayload("host-call-name-ascii-129", "outbound", {
		...envelope,
		args: null,
		type: "hostCall",
		name: "a".repeat(129),
	}),
	invalidPayload("host-call-name-bmp-129", "outbound", {
		...envelope,
		args: null,
		type: "hostCall",
		name: "é".repeat(129),
	}),
	invalidPayload("host-call-name-astral-65", "outbound", {
		...envelope,
		args: null,
		type: "hostCall",
		name: "😀".repeat(65),
	}),
	invalidPayload("done-unknown-phase", "outbound", {
		...envelope,
		usage,
		type: "done",
		console: { entries: [], truncated: false },
		outcome: { message: "x", phase: "boot", status: "failed" },
	}),
	invalid("not-json", "inbound", "payload", framed(new TextEncoder().encode("{run"))),
	invalid(
		"oversize-length",
		"inbound",
		"framing",
		framed(new Uint8Array(0), SIDECAR_PROTOCOL_LIMITS.frameBytes + 1),
	),
	invalid("zero-length", "inbound", "framing", framed(new Uint8Array(0))),
	invalid("truncated", "outbound", "framing", framed(new TextEncoder().encode("{}"), 100)),
];

const verifyExpectation = Effect.fnUntraced(function* (fixture: Fixture) {
	const decoded = yield* Effect.result(
		fixture.direction === "inbound"
			? Effect.asVoid(sidecarInboundFrames.decode(fixture.bytes))
			: Effect.asVoid(sidecarOutboundFrames.decode(fixture.bytes)),
	);
	const actual: Expectation = decoded._tag === "Success" ? "valid" : decoded.failure.reason;
	if (actual !== fixture.expect) {
		return yield* new FixtureError({
			message: `${fixture.name} decodes as ${actual}, expected ${fixture.expect}`,
		});
	}
	return yield* Effect.void;
});

const index = `${JSON.stringify(
	fixtures.map(({ name, expect, direction }) => ({ name, expect, direction })),
	null,
	"\t",
)}\n`;

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const directory = path.resolve(path.dirname(scriptPath), "../../sandboxd/protocol-fixtures");
	yield* Effect.forEach(fixtures, verifyExpectation, { discard: true });
	const expected = new Map<string, Uint8Array>([
		["index.json", new TextEncoder().encode(index)],
		...fixtures.map(({ name, bytes }) => [`${name}.frame`, bytes] as const),
	]);
	if (!process.argv.includes("--check")) {
		yield* fs.remove(directory, { force: true, recursive: true });
		yield* fs.makeDirectory(directory, { recursive: true });
		for (const [file, bytes] of expected) {
			yield* fs.writeFile(path.join(directory, file), bytes);
		}
		return yield* Effect.logInfo(`Wrote ${fixtures.length} sidecar protocol fixtures`);
	}
	const present = (yield* fs.exists(directory)) ? yield* fs.readDirectory(directory) : [];
	const stale: Array<string> = [];
	for (const file of [...new Set([...present, ...expected.keys()])].sort()) {
		const bytes = expected.get(file);
		const target = path.join(directory, file);
		const current = (yield* fs.exists(target)) ? yield* fs.readFile(target) : undefined;
		if (!bytes || !current || Buffer.compare(bytes, current) !== 0) {
			stale.push(file);
		}
	}
	if (stale.length > 0) {
		return yield* new FixtureError({
			message: `Stale sidecar protocol fixtures (run bun run protocol:fixtures in kernel/sandboxd): ${stale.join(", ")}`,
		});
	}
	return yield* Effect.void;
});

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The protocol fixture generator is a command-line entrypoint
	program.pipe(Effect.provide(BunServices.layer)),
);
