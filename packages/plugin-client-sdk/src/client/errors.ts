import type { RyotClientErrorReason } from "@ryot-app/plugin-client-contract";
import { Data } from "effect";

export class RyotClientError extends Data.TaggedError("RyotClientError")<{
	readonly reason: RyotClientErrorReason;
}> {
	constructor(reason: RyotClientErrorReason) {
		super({ reason });
	}
}

export const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError("transport");
