import { useState } from "react";

import { resolveDateTimeInput, toDateTimeInput } from "./datetime-input";

export const useDateTimeInput = (original: string | null | undefined) => {
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
