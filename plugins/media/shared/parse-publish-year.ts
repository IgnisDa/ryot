import dayjs from "@ryot/sandbox-sdk/dayjs";

import { stringValue } from "./records";

export const parsePublishYear = (date: unknown) => {
	const value = stringValue(date);
	if (!value) {
		return null;
	}
	const parsed = dayjs(value);
	return parsed.isValid() && parsed.year() > 0 ? parsed.year() : null;
};
