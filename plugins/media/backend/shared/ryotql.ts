import type { EventReadResult } from "@ryot/sandbox-sdk/ryotql";

export type MediaProgressEvent = Pick<
	EventReadResult["items"][number],
	"createdAt" | "id" | "occurredAt" | "properties"
>;
