import { parse as parseFunction } from "papaparse";

export type * from "papaparse";
export const parse: typeof parseFunction = parseFunction;
