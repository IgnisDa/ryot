import { useState } from "react";

export function useValueChange<Value>(value: Value, onChange: (value: Value) => void) {
	const [previous, setPrevious] = useState(value);
	if (!Object.is(previous, value)) {
		setPrevious(value);
		onChange(value);
	}
}
