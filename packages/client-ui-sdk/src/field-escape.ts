import { useEffect, useEffectEvent, type RefObject } from "react";

export function useFieldEscape(
	ref: RefObject<HTMLInputElement | null>,
	options: { readonly hasValue: boolean; readonly onClear: () => void },
) {
	const clear = useEffectEvent(() => options.onClear());
	const hasValue = options.hasValue;

	useEffect(() => {
		const field = ref.current;
		if (field === null) {
			return undefined;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			if (!hasValue) {
				field.blur();
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			clear();
		};
		field.addEventListener("keydown", onKeyDown);
		return () => field.removeEventListener("keydown", onKeyDown);
	});
}
