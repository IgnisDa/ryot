import { DateTime, Option } from "@ryot-app/plugin-backend-sdk/effect";

import { stringValue } from "./records";

export const releaseInstant = (value: unknown) => {
	const input = typeof value === "number" ? value : stringValue(value);
	if (input === null || (typeof input === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input))) {
		return null;
	}
	return Option.map(DateTime.make(input), DateTime.formatIso).pipe(Option.getOrNull);
};
