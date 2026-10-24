import { MetadataLookupResult } from "@ryot-app/media-plugin/contracts/operations";
import { Effect, Schema } from "effect";

import { ExtensionStatus } from "./extension-types";
import { fromPlatform } from "./platform";

export const RawMediaData = Schema.Struct({ title: Schema.String, progress: Schema.Finite });
export type RawMediaData = typeof RawMediaData.Type;

export const ExtensionMessage = Schema.Union([
	Schema.Struct({ type: Schema.Literal("GET_STATUS") }),
	Schema.Struct({ type: Schema.Literal("GET_CACHED_TITLE") }),
	Schema.Struct({
		type: Schema.Literal("METADATA_LOOKUP"),
		data: Schema.Struct({ title: Schema.String }),
	}),
	Schema.Struct({
		type: Schema.Literal("SEND_PROGRESS_DATA"),
		data: Schema.Struct({ rawData: RawMediaData, metadata: MetadataLookupResult }),
	}),
]);
export type ExtensionMessage = typeof ExtensionMessage.Type;

const responseData = {
	SEND_PROGRESS_DATA: Schema.Null,
	METADATA_LOOKUP: MetadataLookupResult,
	GET_STATUS: Schema.Enum(ExtensionStatus),
	GET_CACHED_TITLE: Schema.NullOr(Schema.String),
};

const response = <S extends Schema.Top>(data: S) =>
	Schema.Union([
		Schema.Struct({ data, success: Schema.Literal(true) }),
		Schema.Struct({ error: Schema.String, success: Schema.Literal(false) }),
	]);

export const sendExtensionMessage = <K extends ExtensionMessage["type"]>(
	message: ExtensionMessage & { readonly type: K },
) =>
	fromPlatform(() => browser.runtime.sendMessage(message)).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(response(responseData[message.type]))),
	);
