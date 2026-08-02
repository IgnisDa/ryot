import {
	ConnectedFrame,
	EntityUpdatedFrame,
	type ConnectedFrame as ConnectedFrameValue,
	type EntityUpdatedFrame as EntityUpdatedFrameValue,
} from "@ryot/contract/modules/entity-interest/messages";
import { Result, Schema } from "effect";

export type InterestStreamEvent =
	| { readonly type: "connected"; readonly frame: ConnectedFrameValue }
	| { readonly type: "entity:updated"; readonly frame: EntityUpdatedFrameValue };

const decodeConnected = Schema.decodeUnknownResult(Schema.fromJsonString(ConnectedFrame));
const decodeEntityUpdated = Schema.decodeUnknownResult(Schema.fromJsonString(EntityUpdatedFrame));

export class InterestSseParser {
	private event = "";
	private buffer = "";
	private readonly data: string[] = [];

	push(chunk: string) {
		this.buffer += chunk;
		const events: InterestStreamEvent[] = [];
		let newline = this.buffer.indexOf("\n");
		while (newline >= 0) {
			const rawLine = this.buffer.slice(0, newline);
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
			this.buffer = this.buffer.slice(newline + 1);
			if (line === "") {
				const parsed = parseEvent(this.event, this.data.join("\n"));
				this.event = "";
				this.data.length = 0;
				if (parsed) {
					events.push(parsed);
				}
			} else if (!line.startsWith(":")) {
				if (line.startsWith("event:")) {
					this.event = line.slice("event:".length).trim();
				} else if (line.startsWith("data:")) {
					this.data.push(line.slice("data:".length).trimStart());
				}
			}
			newline = this.buffer.indexOf("\n");
		}
		return events;
	}
}

const parseEvent = (event: string, payload: string): InterestStreamEvent | undefined => {
	if (event === "connected") {
		const decoded = decodeConnected(payload);
		return Result.isSuccess(decoded) ? { type: "connected", frame: decoded.success } : undefined;
	}
	if (event === "entity:updated") {
		const decoded = decodeEntityUpdated(payload);
		return Result.isSuccess(decoded)
			? { type: "entity:updated", frame: decoded.success }
			: undefined;
	}
	return undefined;
};
