import {
	contains as containsFunction,
	load as loadFunction,
	merge as mergeFunction,
} from "cheerio";

export type * from "cheerio";
export const load: typeof loadFunction = loadFunction;
export const merge: typeof mergeFunction = mergeFunction;
export const contains: typeof containsFunction = containsFunction;
