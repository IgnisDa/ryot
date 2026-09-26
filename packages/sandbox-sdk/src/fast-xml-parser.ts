import {
	COMMON_HTML as COMMON_HTML_ENTITIES,
	CURRENCY as CURRENCY_ENTITIES,
	EntityDecoder as EntityDecoderClass,
	type EntityDecoderOptions as EntitiesDecoderOptions,
} from "@nodable/entities";
import {
	XMLParser as XMLParserClass,
	type EntityDecoderOptions as XMLEntityDecoder,
} from "fast-xml-parser";

// The package exports EntityDecoder by name at runtime but only types it as a default export.
declare module "@nodable/entities" {
	export const EntityDecoder: new (options?: EntitiesDecoderOptions) => XMLEntityDecoder;
}

export type * from "fast-xml-parser";
export const XMLParser: typeof XMLParserClass = XMLParserClass;
export const EntityDecoder: typeof EntityDecoderClass = EntityDecoderClass;
export const COMMON_HTML: typeof COMMON_HTML_ENTITIES = COMMON_HTML_ENTITIES;
export const CURRENCY: typeof CURRENCY_ENTITIES = CURRENCY_ENTITIES;
