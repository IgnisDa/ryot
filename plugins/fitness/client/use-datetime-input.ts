import { resolveDateTimeInput, toDateTimeInput } from "@ryot-app/plugin-ui-sdk/datetime";
import { useState } from "react";

export const useDateTimeInput = (original: null | string | undefined) => {
	const [value, setValue] = useState(() => (original ? toDateTimeInput(original) : ""));
	const [occurrence, setOccurrence] = useState<string>();
	return {
		value,
		onOccurrenceChange: setOccurrence,
		resolution: resolveDateTimeInput(value, original, occurrence),
		onChange: (next: string) => {
			setValue(next);
			setOccurrence(undefined);
		},
	};
};
