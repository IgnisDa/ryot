import {
	decodeSidecarOutboundLogicalMessage,
	encodeSidecarInboundLogicalMessage,
	SIDECAR_PROTOCOL_LIMITS,
	SidecarProtocolError,
	type SidecarInboundFrame,
	type SidecarOutboundFrame,
} from "./sidecar-protocol";

const frameHeaderBytes = 4;
const maximumFrameBytes = SIDECAR_PROTOCOL_LIMITS.frameBytes;
const maximumPartBytes = SIDECAR_PROTOCOL_LIMITS.partBytes;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type SidecarFrameReaderOptions = {
	readonly generation: number;
	readonly maximumAssemblies: number;
	readonly maximumBufferedBytes: number;
	readonly isActive: (handle: string) => boolean;
	readonly onFrame: (frame: SidecarOutboundFrame) => void;
	readonly onInvalid: (handle: string, message: string) => void;
};

type SidecarFrameWriterOptions = {
	readonly maximumRunMessages: number;
	readonly maximumControlMessages: number;
	readonly maximumQueuedBytes: number;
	readonly write: (bytes: Uint8Array) => { readonly written: number; readonly blocked: boolean };
};

type FrameEnvelope = { readonly generation: number; readonly handle: string; readonly seq: number };

type Assembly = {
	readonly envelope: FrameEnvelope;
	readonly frameType: "done" | "hostCall";
	readonly count: number;
	readonly byteLength: number;
	readonly chunks: Uint8Array[];
	bytes: number;
	index: number;
};

const protocolError = (reason: "framing" | "payload", message: string) =>
	new SidecarProtocolError({ reason, message });

const validateLimit = (name: string, value: number, minimum = 0) => {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw protocolError(
			"framing",
			`${name} must be a safe integer greater than or equal to ${minimum}`,
		);
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isWriteResult = (
	value: unknown,
): value is { readonly written: number; readonly blocked: boolean } =>
	isRecord(value) && typeof value["written"] === "number" && typeof value["blocked"] === "boolean";

const requireWriteResult = (value: unknown, fail: (error: SidecarProtocolError) => never) => {
	if (!isWriteResult(value)) {
		return fail(protocolError("framing", "writer returned an invalid write result"));
	}
	return value;
};

const readEnvelope = (
	value: unknown,
): {
	readonly handle: string | undefined;
	readonly generation: unknown;
	readonly type: unknown;
} => {
	if (!isRecord(value)) {
		return { type: undefined, handle: undefined, generation: undefined };
	}
	return {
		type: value["type"],
		generation: value["generation"],
		handle: typeof value["handle"] === "string" ? value["handle"] : undefined,
	};
};

const decodeBase64 = (value: string) => {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const padding = base64Padding(value);
	const bytes = new Uint8Array((value.length / 4) * 3 - padding);
	let outputIndex = 0;
	for (let index = 0; index < value.length; index += 4) {
		const first = alphabet.indexOf(value[index] ?? "");
		const second = alphabet.indexOf(value[index + 1] ?? "");
		const third = value[index + 2] === "=" ? 0 : alphabet.indexOf(value[index + 2] ?? "");
		const fourth = value[index + 3] === "=" ? 0 : alphabet.indexOf(value[index + 3] ?? "");
		const word = (first << 18) | (second << 12) | (third << 6) | fourth;
		if (outputIndex < bytes.byteLength) {
			bytes[outputIndex] = (word >> 16) & 255;
			outputIndex += 1;
		}
		if (outputIndex < bytes.byteLength) {
			bytes[outputIndex] = (word >> 8) & 255;
			outputIndex += 1;
		}
		if (outputIndex < bytes.byteLength) {
			bytes[outputIndex] = word & 255;
			outputIndex += 1;
		}
	}
	return bytes;
};

const decodedBase64Length = (value: string) => (value.length / 4) * 3 - base64Padding(value);

function base64Padding(value: string) {
	if (value.endsWith("==")) {
		return 2;
	}
	return value.endsWith("=") ? 1 : 0;
}

const encodeBase64 = (bytes: Uint8Array) => {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.byteLength; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const word = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
		output += alphabet[(word >> 18) & 63];
		output += alphabet[(word >> 12) & 63];
		output += second === undefined ? "=" : alphabet[(word >> 6) & 63];
		output += third === undefined ? "=" : alphabet[word & 63];
	}
	return output;
};

const utf8Length = (text: string) => {
	let bytes = 0;
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 0x7f) {
			bytes += 1;
		} else if (codePoint <= 0x7ff) {
			bytes += 2;
		} else if (codePoint <= 0xffff) {
			bytes += 3;
		} else {
			bytes += 4;
		}
	}
	return bytes;
};

const framePayload = (payload: Uint8Array) => {
	if (payload.byteLength === 0 || payload.byteLength > maximumFrameBytes) {
		throw protocolError(
			"framing",
			`frame length ${payload.byteLength} is outside 1..${maximumFrameBytes}`,
		);
	}
	const bytes = new Uint8Array(frameHeaderBytes + payload.byteLength);
	new DataView(bytes.buffer).setUint32(0, payload.byteLength);
	bytes.set(payload, frameHeaderBytes);
	return bytes;
};

export const makeSidecarFrameReader = ({
	onFrame,
	isActive,
	onInvalid,
	generation,
	maximumAssemblies,
	maximumBufferedBytes,
}: SidecarFrameReaderOptions) => {
	validateLimit("generation", generation);
	validateLimit("maximumAssemblies", maximumAssemblies);
	validateLimit("maximumBufferedBytes", maximumBufferedBytes, frameHeaderBytes);
	const header = new Uint8Array(frameHeaderBytes);
	const assemblies = new Map<string, Assembly>();
	let headerBytes = 0;
	let body: Uint8Array | undefined;
	let bodyBytes = 0;
	let bufferedBytes = 0;
	let closed = false;
	let failure: SidecarProtocolError | undefined;

	const clearAssembly = (key: string) => {
		const assembly = assemblies.get(key);
		if (assembly !== undefined) {
			bufferedBytes -= assembly.bytes;
			assemblies.delete(key);
		}
	};

	const invalidActive = (handle: string, message: string, key?: string) => {
		if (key !== undefined) {
			clearAssembly(key);
		}
		if (isActive(handle)) {
			onInvalid(handle, message);
		}
	};

	const fail = (error: SidecarProtocolError): never => {
		failure = error;
		throw error;
	};

	const processPart = (frame: Extract<SidecarOutboundFrame, { type: "part" }>) => {
		if (frame.frameType !== "done" && frame.frameType !== "hostCall") {
			invalidActive(frame.handle, `outbound part type ${frame.frameType} is not supported`);
			return;
		}
		const key = `${frame.handle}:${frame.seq}:${frame.frameType}`;
		const maximumBytes = SIDECAR_PROTOCOL_LIMITS.messageBytes[frame.frameType];
		if (frame.byteLength > maximumBytes) {
			invalidActive(
				frame.handle,
				`logical ${frame.frameType} message exceeds ${maximumBytes} bytes`,
				key,
			);
			return;
		}
		if (frame.count !== Math.ceil(frame.byteLength / maximumPartBytes)) {
			invalidActive(frame.handle, "part count does not match the declared byte length", key);
			return;
		}
		let assembly = assemblies.get(key);
		if (assembly === undefined) {
			if (frame.index !== 0) {
				invalidActive(frame.handle, "a chunked message must start at part 0", key);
				return;
			}
			if (assemblies.size >= maximumAssemblies) {
				fail(protocolError("framing", `pending assembly count exceeds ${maximumAssemblies}`));
			}
			assembly = {
				bytes: 0,
				index: 0,
				chunks: [],
				count: frame.count,
				frameType: frame.frameType,
				byteLength: frame.byteLength,
				envelope: { seq: frame.seq, handle: frame.handle, generation: frame.generation },
			};
			assemblies.set(key, assembly);
		}
		if (
			frame.index !== assembly.index ||
			frame.count !== assembly.count ||
			frame.byteLength !== assembly.byteLength ||
			frame.frameType !== assembly.frameType ||
			frame.generation !== assembly.envelope.generation ||
			frame.handle !== assembly.envelope.handle ||
			frame.seq !== assembly.envelope.seq
		) {
			invalidActive(frame.handle, "part does not continue its logical message", key);
			return;
		}
		const partLength = decodedBase64Length(frame.data);
		const expectedBytes = Math.min(maximumPartBytes, assembly.byteLength - assembly.bytes);
		if (partLength === 0 || partLength !== expectedBytes) {
			invalidActive(frame.handle, "part data has the wrong decoded length", key);
			return;
		}
		if (bufferedBytes + partLength > maximumBufferedBytes) {
			fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
		}
		const part = decodeBase64(frame.data);
		assembly.chunks.push(part);
		assembly.bytes += part.byteLength;
		assembly.index += 1;
		bufferedBytes += part.byteLength;
		if (assembly.index < assembly.count) {
			return;
		}
		if (assembly.bytes !== assembly.byteLength) {
			invalidActive(frame.handle, "assembled message length does not match byteLength", key);
			return;
		}
		if (bufferedBytes + assembly.byteLength > maximumBufferedBytes) {
			fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
		}
		const logicalBytes = new Uint8Array(assembly.byteLength);
		let offset = 0;
		for (const chunk of assembly.chunks) {
			logicalBytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		clearAssembly(key);
		bufferedBytes += logicalBytes.byteLength;
		let logicalFrame: SidecarOutboundFrame;
		try {
			logicalFrame = decodeSidecarOutboundLogicalMessage(logicalBytes);
		} catch (error) {
			invalidActive(
				frame.handle,
				error instanceof Error ? error.message : "invalid assembled logical message",
			);
			return;
		} finally {
			bufferedBytes -= logicalBytes.byteLength;
		}
		if (
			logicalFrame.type !== assembly.frameType ||
			!("handle" in logicalFrame) ||
			logicalFrame.handle !== assembly.envelope.handle ||
			logicalFrame.generation !== assembly.envelope.generation ||
			logicalFrame.seq !== assembly.envelope.seq
		) {
			invalidActive(frame.handle, "assembled envelope does not match its parts");
			return;
		}
		onFrame(logicalFrame);
	};

	const processPayload = (payload: Uint8Array) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(decoder.decode(payload));
		} catch (error) {
			fail(
				protocolError("payload", error instanceof Error ? error.message : "invalid JSON payload"),
			);
		}
		const envelope = readEnvelope(parsed);
		if (typeof envelope.generation === "number" && envelope.generation !== generation) {
			return;
		}
		const lifecycle = envelope.type === "ready" || envelope.type === "draining";
		if (envelope.handle === undefined) {
			if (!lifecycle) {
				fail(protocolError("payload", "invalid frame has no identifiable handle"));
			}
			if (envelope.generation !== generation) {
				fail(protocolError("payload", "invalid lifecycle frame has no identifiable generation"));
			}
		} else if (!isActive(envelope.handle)) {
			return;
		}
		const frame = decodePayload(payload, envelope.handle);
		if (frame === undefined) {
			return;
		}
		if (frame.generation !== generation) {
			return;
		}
		if (frame.type === "part") {
			processPart(frame);
			return;
		}
		if ("handle" in frame && !isActive(frame.handle)) {
			return;
		}
		onFrame(frame);
	};

	const decodePayload = (
		payload: Uint8Array,
		handle: string | undefined,
	): SidecarOutboundFrame | undefined => {
		try {
			return decodeSidecarOutboundLogicalMessage(payload);
		} catch (error) {
			if (handle !== undefined) {
				invalidActive(handle, error instanceof Error ? error.message : "invalid sidecar payload");
				return undefined;
			}
			return fail(
				protocolError(
					"payload",
					error instanceof Error ? error.message : "invalid lifecycle payload",
				),
			);
		}
	};

	return {
		close() {
			closed = true;
			assemblies.clear();
			body = undefined;
			bufferedBytes = 0;
			headerBytes = 0;
			bodyBytes = 0;
		},
		retire(handle: string) {
			for (const [key, assembly] of assemblies) {
				if (assembly.envelope.handle === handle) {
					clearAssembly(key);
				}
			}
		},
		feed(bytes: Uint8Array) {
			if (closed) {
				throw failure ?? protocolError("framing", "reader is closed");
			}
			for (const byte of bytes) {
				if (failure !== undefined) {
					throw failure;
				}
				if (body === undefined) {
					if (bufferedBytes + 1 > maximumBufferedBytes) {
						fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
					}
					header[headerBytes] = byte;
					headerBytes += 1;
					bufferedBytes += 1;
					if (headerBytes !== frameHeaderBytes) {
						continue;
					}
					const length = new DataView(header.buffer).getUint32(0);
					if (length === 0 || length > maximumFrameBytes) {
						fail(
							protocolError("framing", `frame length ${length} is outside 1..${maximumFrameBytes}`),
						);
					}
					bufferedBytes -= frameHeaderBytes;
					headerBytes = 0;
					if (bufferedBytes + length > maximumBufferedBytes) {
						fail(protocolError("framing", `pending bytes exceed ${maximumBufferedBytes}`));
					}
					body = new Uint8Array(length);
					bodyBytes = 0;
					bufferedBytes += length;
					continue;
				}
				body[bodyBytes] = byte;
				bodyBytes += 1;
				if (bodyBytes !== body.byteLength) {
					continue;
				}
				const completeBody = body;
				try {
					processPayload(completeBody);
				} finally {
					body = undefined;
					bodyBytes = 0;
					bufferedBytes -= completeBody.byteLength;
				}
			}
		},
	};
};

type QueuedMessage = {
	readonly handle: string;
	readonly category: "run" | "control";
	readonly frames: Uint8Array[];
	counted: boolean;
	retired: boolean;
};

type CurrentFrame = { readonly message: QueuedMessage; readonly bytes: Uint8Array; offset: number };

const messageCategory = (frame: SidecarInboundFrame): "run" | "control" => {
	if (frame.type === "run") {
		return "run";
	}
	if (frame.type === "part") {
		if (frame.frameType !== "run" && frame.frameType !== "hostResult") {
			throw protocolError("payload", `inbound part type ${frame.frameType} is not supported`);
		}
		const maximumBytes = SIDECAR_PROTOCOL_LIMITS.messageBytes[frame.frameType];
		const partLength = decodedBase64Length(frame.data);
		const expectedCount = Math.ceil(frame.byteLength / maximumPartBytes);
		const expectedPartLength = Math.min(
			maximumPartBytes,
			frame.byteLength - frame.index * maximumPartBytes,
		);
		if (
			frame.byteLength > maximumBytes ||
			frame.count !== expectedCount ||
			partLength === 0 ||
			partLength !== expectedPartLength
		) {
			throw protocolError("payload", "inbound part metadata does not match its payload");
		}
		if (frame.frameType === "run") {
			return "run";
		}
		return "control";
	}
	return "control";
};

const encodeMessageFrames = (
	frame: SidecarInboundFrame,
	logicalJson: string,
	logicalBytes: number,
) => {
	if (frame.type === "part") {
		const encoded = encoder.encode(logicalJson);
		return [framePayload(encoded)];
	}
	if ((frame.type !== "run" && frame.type !== "hostResult") || logicalBytes <= maximumFrameBytes) {
		return [framePayload(encoder.encode(logicalJson))];
	}
	const payload = encoder.encode(logicalJson);
	const count = Math.ceil(payload.byteLength / maximumPartBytes);
	const frames: Uint8Array[] = [];
	for (let index = 0; index < count; index += 1) {
		const chunk = payload.subarray(index * maximumPartBytes, (index + 1) * maximumPartBytes);
		const part: SidecarInboundFrame = {
			count,
			index,
			type: "part",
			seq: frame.seq,
			handle: frame.handle,
			frameType: frame.type,
			data: encodeBase64(chunk),
			generation: frame.generation,
			byteLength: payload.byteLength,
		};
		const partJson = encodeSidecarInboundLogicalMessage(part);
		const partBytes = encoder.encode(partJson);
		frames.push(framePayload(partBytes));
	}
	return frames;
};

const estimateMessageBytes = (frame: SidecarInboundFrame, logicalBytes: number) => {
	if (
		frame.type === "part" ||
		(frame.type !== "run" && frame.type !== "hostResult") ||
		logicalBytes <= maximumFrameBytes
	) {
		return logicalBytes + frameHeaderBytes;
	}
	const count = Math.ceil(logicalBytes / maximumPartBytes);
	let total = 0;
	for (let index = 0; index < count; index += 1) {
		const partBytes = Math.min(maximumPartBytes, logicalBytes - index * maximumPartBytes);
		const padding = (3 - (partBytes % 3)) % 3;
		const dataLength = Math.ceil(partBytes / 3) * 4;
		const data = `${"A".repeat(dataLength - padding)}${"=".repeat(padding)}`;
		const part: SidecarInboundFrame = {
			data,
			count,
			index,
			type: "part",
			seq: frame.seq,
			handle: frame.handle,
			frameType: frame.type,
			byteLength: logicalBytes,
			generation: frame.generation,
		};
		total += utf8Length(encodeSidecarInboundLogicalMessage(part)) + frameHeaderBytes;
	}
	return total;
};

export const makeSidecarFrameWriter = ({
	write,
	maximumRunMessages,
	maximumQueuedBytes,
	maximumControlMessages,
}: SidecarFrameWriterOptions) => {
	validateLimit("maximumRunMessages", maximumRunMessages);
	validateLimit("maximumControlMessages", maximumControlMessages);
	validateLimit("maximumQueuedBytes", maximumQueuedBytes, frameHeaderBytes + 1);
	const runQueue: QueuedMessage[] = [];
	const controlQueue: QueuedMessage[] = [];
	let runMessages = 0;
	let controlMessages = 0;
	let queuedBytes = 0;
	let current: CurrentFrame | undefined;
	let closed = false;

	const dropMessage = (message: QueuedMessage) => {
		queuedBytes -= message.frames.reduce((total, bytes) => total + bytes.byteLength, 0);
		message.frames.length = 0;
		if (message.counted) {
			if (message.category === "run") {
				runMessages -= 1;
			} else {
				controlMessages -= 1;
			}
			message.counted = false;
		}
	};

	const fail = (error: SidecarProtocolError): never => {
		closed = true;
		runQueue.length = 0;
		controlQueue.length = 0;
		runMessages = 0;
		controlMessages = 0;
		queuedBytes = 0;
		current = undefined;
		throw error;
	};

	const takeNext = () => controlQueue.shift() ?? runQueue.shift();

	const removeQueuedRuns = (handle: string) => {
		for (let index = runQueue.length - 1; index >= 0; index -= 1) {
			const message = runQueue[index];
			if (message?.handle === handle) {
				runQueue.splice(index, 1);
				dropMessage(message);
			}
		}
		if (current?.message.category === "run" && current.message.handle === handle) {
			if (current.offset === 0) {
				const message = current.message;
				current = undefined;
				dropMessage(message);
			} else {
				const message = current.message;
				const remainingFrames = message.frames.slice(1);
				queuedBytes -= remainingFrames.reduce((total, bytes) => total + bytes.byteLength, 0);
				message.frames.splice(1);
				message.retired = true;
				if (message.counted) {
					runMessages -= 1;
					message.counted = false;
				}
			}
		}
	};

	return {
		retire(handle: string) {
			if (closed) {
				return;
			}
			removeQueuedRuns(handle);
		},
		close() {
			closed = true;
			runQueue.length = 0;
			controlQueue.length = 0;
			runMessages = 0;
			controlMessages = 0;
			queuedBytes = 0;
			current = undefined;
		},
		flush() {
			if (closed) {
				throw protocolError("framing", "writer is closed");
			}
			while (current !== undefined || controlQueue.length > 0 || runQueue.length > 0) {
				if (current === undefined) {
					const message = takeNext();
					if (message === undefined) {
						return;
					}
					const bytes = message.frames[0];
					if (bytes === undefined) {
						dropMessage(message);
						continue;
					}
					current = { bytes, message, offset: 0 };
				}
				const frame = current;
				let writeResult: unknown;
				try {
					writeResult = write(frame.bytes.slice(frame.offset));
				} catch (error) {
					fail(protocolError("framing", error instanceof Error ? error.message : "write failed"));
				}
				const result = requireWriteResult(writeResult, fail);
				const remaining = frame.bytes.byteLength - frame.offset;
				if (
					!Number.isSafeInteger(result.written) ||
					result.written < 0 ||
					result.written > remaining
				) {
					fail(protocolError("framing", "writer returned an invalid write count"));
				}
				frame.offset += result.written;
				if (frame.offset === frame.bytes.byteLength) {
					frame.message.frames.shift();
					queuedBytes -= frame.bytes.byteLength;
					current = undefined;
					if (frame.message.retired || frame.message.frames.length === 0) {
						dropMessage(frame.message);
					} else if (frame.message.category === "run") {
						runQueue.push(frame.message);
					} else {
						controlQueue.push(frame.message);
					}
				}
				if (result.blocked || result.written === 0) {
					return;
				}
			}
		},
		enqueue(frame: SidecarInboundFrame) {
			if (closed) {
				throw protocolError("framing", "writer is closed");
			}
			let logicalJson: string;
			try {
				logicalJson = encodeSidecarInboundLogicalMessage(frame);
			} catch (error) {
				throw protocolError(
					"payload",
					error instanceof Error ? error.message : "invalid inbound frame",
				);
			}
			const logicalBytes = utf8Length(logicalJson);
			let logicalCap = maximumFrameBytes;
			if (frame.type === "run") {
				logicalCap = SIDECAR_PROTOCOL_LIMITS.messageBytes.run;
			} else if (frame.type === "hostResult") {
				logicalCap = SIDECAR_PROTOCOL_LIMITS.messageBytes.hostResult;
			}
			if (logicalBytes > logicalCap) {
				throw protocolError("payload", `logical ${frame.type} message exceeds ${logicalCap} bytes`);
			}
			const category = messageCategory(frame);
			const messageLimitReached =
				category === "run"
					? runMessages >= maximumRunMessages
					: controlMessages >= maximumControlMessages;
			if (messageLimitReached) {
				fail(protocolError("framing", `queued ${category} message count is full`));
			}
			const retainedBytes = estimateMessageBytes(frame, logicalBytes);
			if (queuedBytes + retainedBytes > maximumQueuedBytes) {
				fail(protocolError("framing", `queued bytes exceed ${maximumQueuedBytes}`));
			}
			const frames = encodeMessageFrames(frame, logicalJson, logicalBytes);
			const encodedBytes = frames.reduce((total, bytes) => total + bytes.byteLength, 0);
			if (encodedBytes !== retainedBytes) {
				fail(protocolError("framing", "encoded queue size did not match its reservation"));
			}
			const message: QueuedMessage = {
				frames,
				category,
				counted: true,
				retired: false,
				handle: frame.handle,
			};
			queuedBytes += retainedBytes;
			if (category === "run") {
				runMessages += 1;
				runQueue.push(message);
			} else {
				controlMessages += 1;
				controlQueue.push(message);
			}
		},
	};
};
