import type { EventReadResult } from "@ryot-app/sandbox-sdk/ryotql";

export type MediaProgressEvent = Pick<
	EventReadResult["items"][number],
	"createdAt" | "id" | "occurredAt" | "properties"
>;
