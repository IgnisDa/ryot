import type { RyotClientErrorReason } from "@ryot-app/plugin-client-contract";
import { Data } from "effect";

export class RyotClientError extends Data.TaggedError("RyotClientError")<{
	readonly message?: string;
	readonly reason: RyotClientErrorReason;
}> {
	constructor(reason: RyotClientErrorReason, message?: string) {
		super(message === undefined ? { reason } : { reason, message });
	}
}

export const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError("transport");
