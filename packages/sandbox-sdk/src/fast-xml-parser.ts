import { XMLParser as XMLParserClass } from "fast-xml-parser";

export type * from "fast-xml-parser";
export const XMLParser: typeof XMLParserClass = XMLParserClass;
