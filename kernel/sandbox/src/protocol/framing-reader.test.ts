import { Base64 } from "effect/encoding";
import { describe, expect, it } from "vitest";

import { framePayload, makeSidecarFrameReader } from "./framing";
import { MiB, SANDBOX_LIMITS } from "./limits";
import { SIDECAR_PROTOCOL_LIMITS, type SidecarOutboundFrame } from "./messages";

const encoder = new TextEncoder();
const partBytes = SIDECAR_PROTOCOL_LIMITS.partBytes;
const logicalBytes = 8 * partBytes;

type Part = Extract<SidecarOutboundFrame, { type: "part" }>;

const required = <Value>(value: Value | undefined) => {
	if (value === undefined) {
		throw new Error("expected a fixture value");
	}
	return value;
};

const wire = (frame: unknown) => framePayload(encoder.encode(JSON.stringify(frame)));

const parts = (handle: string, size = logicalBytes, seq = 1) => {
	const frame = {
		seq,
		handle,
		type: "done",
		generation: 7,
		console: { entries: [], truncated: false },
		outcome: { value: "", status: "completed" },
		usage: { cpuWaitMs: 0, heapBytes: 0, externalBytes: 0 },
	} satisfies SidecarOutboundFrame;
	const overhead = encoder.encode(JSON.stringify(frame)).byteLength;
	const payload = encoder.encode(
		JSON.stringify({ ...frame, outcome: { ...frame.outcome, value: "x".repeat(size - overhead) } }),
	);
	return Array.from(
		{ length: Math.ceil(size / partBytes) },
		(_, index) =>
			({
				seq,
				index,
				handle,
				type: "part",
				generation: 7,
				byteLength: size,
				frameType: "done",
				count: Math.ceil(size / partBytes),
				data: Base64.encode(payload.subarray(index * partBytes, (index + 1) * partBytes)),
			}) satisfies Part,
	);
};

const readerHarness = (maximumBufferedBytes: number, maximumAssemblies = 8) => {
	const received: SidecarOutboundFrame[] = [];
	const invalid: string[] = [];
	const active = new Set(["first", "third", "second", "fourth"]);
	const reader = makeSidecarFrameReader({
		generation: 7,
		maximumAssemblies,
		maximumBufferedBytes,
		isActive: (handle) => active.has(handle),
		onFrame: (frame) => received.push(frame),
		onInvalid: (handle) => invalid.push(handle),
	});
	return { reader, active, invalid, received };
};

const feed = (reader: ReturnType<typeof makeSidecarFrameReader>, frames: readonly unknown[]) => {
	for (const frame of frames) {
		reader.feed(wire(frame));
	}
};

describe("sidecar reader assembly reservations", () => {
	it("charges the complete declared destination and transient decode at the first part", () => {
		const first = required(parts("first")[0]);
		const physicalBytes = wire(first).byteLength - 4;
		for (const budget of [
			logicalBytes + physicalBytes - 1,
			logicalBytes + physicalBytes + partBytes - 1,
		]) {
			const { reader, invalid, received } = readerHarness(budget);
			expect(() => feed(reader, [first])).toThrow(`pending bytes exceed ${budget}`);
			expect(received).toEqual([]);
			expect(invalid).toEqual([]);
			reader.close();
			reader.close();
			expect(() => feed(reader, [first])).toThrow(`pending bytes exceed ${budget}`);
		}
	});

	it("keeps the exact full reservation between parts and charges physical frame allocation", () => {
		const first = required(parts("first")[0]);
		const physicalBytes = wire(first).byteLength - 4;
		const budget = logicalBytes + physicalBytes + partBytes;
		const { reader } = readerHarness(budget);
		feed(reader, [first]);
		const header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, physicalBytes + partBytes + 1);
		expect(() => reader.feed(header)).toThrow(`pending bytes exceed ${budget}`);
		reader.close();
	});

	it("completes and reuses one destination without a second logical allocation", () => {
		const frames = parts("first");
		const physicalBytes = Math.max(...frames.map((frame) => wire(frame).byteLength - 4));
		const { reader, invalid, received } = readerHarness(
			logicalBytes + physicalBytes + partBytes,
			1,
		);
		for (let seq = 1; seq <= 3; seq += 1) {
			feed(reader, parts("first", logicalBytes, seq));
		}
		expect(received.map((frame) => frame.type)).toEqual(["done", "done", "done"]);
		expect(invalid).toEqual([]);
		reader.close();
	});

	it.each([1, 2])("accepts two maximum outbound messages per thread with %i threads", (threads) => {
		const handles = ["first", "second", "third", "fourth"].slice(0, threads * 2);
		const messages = handles.map((handle) =>
			parts(handle, SIDECAR_PROTOCOL_LIMITS.messageBytes.done),
		);
		const { reader, invalid, received } = readerHarness(
			threads * SANDBOX_LIMITS.sidecar.bufferedBytesPerThread,
			threads * 5,
		);
		for (let index = 0; index < SIDECAR_PROTOCOL_LIMITS.messageBytes.done / partBytes; index += 1) {
			for (const message of messages) {
				feed(reader, [required(message[index])]);
			}
		}
		expect(received.map((frame) => ("handle" in frame ? frame.handle : undefined))).toEqual(
			handles,
		);
		expect(invalid).toEqual([]);
		reader.close();
	});

	it("reserves every concurrent declaration instead of only received chunks", () => {
		const first = required(parts("first")[0]);
		const second = required(parts("second")[0]);
		const budget = 2 * logicalBytes + wire(second).byteLength - 4 + partBytes - 1;
		const { reader } = readerHarness(budget);
		feed(reader, [first]);
		expect(() => feed(reader, [second])).toThrow(`pending bytes exceed ${budget}`);
		reader.close();
	});

	it.each(["duplicate", "count", "size", "short", "base64", "json", "envelope", "retire"])(
		"releases a %s assembly exactly once and immediately reuses its budget",
		(failure) => {
			const survivor = parts("first");
			const victim = parts("second");
			const firstVictim = required(victim[0]);
			const secondVictim = required(victim[1]);
			const physicalBytes = Math.max(...victim.map((frame) => wire(frame).byteLength - 4));
			const budget = 2 * logicalBytes + physicalBytes + partBytes;
			const { reader, active, invalid, received } = readerHarness(budget);
			feed(reader, [required(survivor[0])]);
			if (failure === "json") {
				feed(reader, [{ ...firstVictim, data: Base64.encode(new Uint8Array(partBytes)) }]);
			} else if (failure === "envelope") {
				feed(reader, [{ ...firstVictim, seq: 2 }]);
			} else {
				feed(reader, [firstVictim]);
			}
			switch (failure) {
				case "size":
					feed(reader, [{ ...secondVictim, byteLength: logicalBytes - 1 }]);
					break;
				case "json":
					feed(reader, victim.slice(1));
					break;
				case "count":
					feed(reader, [{ ...secondVictim, count: secondVictim.count + 1 }]);
					break;
				case "short":
					feed(reader, [{ ...secondVictim, data: Base64.encode(new Uint8Array(partBytes - 1)) }]);
					break;
				case "base64":
					feed(reader, [{ ...secondVictim, data: "!!!!" }]);
					break;
				case "retire":
					active.delete("second");
					reader.retire("second");
					feed(reader, victim.slice(1));
					break;
				case "envelope":
					for (const frame of victim.slice(1)) {
						feed(reader, [{ ...frame, seq: 2 }]);
					}
					break;
				case "duplicate":
					feed(reader, [firstVictim]);
					break;
			}
			expect(invalid).toEqual(failure === "retire" ? [] : ["second"]);
			active.add("second");
			feed(reader, victim);
			reader.retire("second");
			reader.retire("second");
			feed(reader, survivor.slice(1));
			expect(received.map((frame) => ("handle" in frame ? frame.handle : undefined))).toEqual([
				"second",
				"first",
			]);
			feed(reader, [required(survivor[0]), firstVictim]);
			expect(() => feed(reader, [required(parts("third")[0])])).toThrow(
				`pending bytes exceed ${budget}`,
			);
			reader.close();
			reader.close();
		},
	);

	it("ignores foreign and inactive declarations and rejects caps and inbound directions before reserving", () => {
		const frames = parts("first");
		const first = required(frames[0]);
		const { reader, invalid, received } = readerHarness(MiB, 1);
		feed(reader, [
			{ ...first, generation: 8 },
			{ ...first, handle: "inactive" },
			{ ...first, frameType: "run" },
			{ ...first, frameType: "hostResult" },
			{ ...first, count: first.count + 1 },
			{ ...first, count: 97, byteLength: SIDECAR_PROTOCOL_LIMITS.messageBytes.done + 1 },
			{
				...first,
				count: 33,
				frameType: "hostCall",
				byteLength: SIDECAR_PROTOCOL_LIMITS.messageBytes.hostCall + 1,
			},
		]);
		feed(reader, frames);
		expect(invalid).toEqual(["first", "first", "first", "first", "first"]);
		expect(received).toHaveLength(1);
		reader.close();
	});
});
