import {
	gunzipSync as gunzipSyncFunction,
	strFromU8 as strFromU8Function,
	unzipSync as unzipSyncFunction,
} from "fflate";

export type * from "fflate";
export const unzipSync: typeof unzipSyncFunction = unzipSyncFunction;
export const strFromU8: typeof strFromU8Function = strFromU8Function;
export const gunzipSync: typeof gunzipSyncFunction = gunzipSyncFunction;
