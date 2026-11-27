import type { EventReadResult } from "@ryot-app/plugin-backend-sdk/ryotql";

export type MediaProgressEvent = Pick<
	EventReadResult["items"][number],
	"id" | "createdAt" | "occurredAt" | "properties"
>;
