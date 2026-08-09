import { DateTime, Option } from "@ryot/sandbox-sdk/effect";

import { stringValue } from "./records";

export const parsePublishYear = (date: unknown) => {
	const value = stringValue(date);
	if (!value) {
		return null;
	}
	const parsed = DateTime.make(value);
	if (Option.isNone(parsed)) {
		return null;
	}
	const year = DateTime.toDateUtc(parsed.value).getFullYear();
	return year > 0 ? year : null;
};
