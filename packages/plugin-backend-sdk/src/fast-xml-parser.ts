import {
	COMMON_HTML as COMMON_HTML_ENTITIES,
	CURRENCY as CURRENCY_ENTITIES,
	EntityDecoder as EntityDecoderClass,
} from "@nodable/entities";
import { XMLParser as XMLParserClass } from "fast-xml-parser";

export type * from "fast-xml-parser";
export const XMLParser: typeof XMLParserClass = XMLParserClass;
export const EntityDecoder: typeof EntityDecoderClass = EntityDecoderClass;
export const COMMON_HTML: typeof COMMON_HTML_ENTITIES = COMMON_HTML_ENTITIES;
export const CURRENCY: typeof CURRENCY_ENTITIES = CURRENCY_ENTITIES;
