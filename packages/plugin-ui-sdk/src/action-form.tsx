import type { ComponentProps, KeyboardEvent } from "react";

const submitOnEnterInputTypes = new Set([
	"tel",
	"url",
	"text",
	"email",
	"number",
	"search",
	"password",
]);

type ActionFormProps = Omit<ComponentProps<"div">, "role" | "onSubmit" | "aria-label"> & {
	readonly label: string;
	readonly onSubmit: () => void;
};

const isSubmitOnEnterInput = (target: null | EventTarget): target is HTMLInputElement =>
	target instanceof HTMLInputElement && submitOnEnterInputTypes.has(target.type);

export function ActionForm({ label, onSubmit, onKeyDown, ...props }: ActionFormProps) {
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		onKeyDown?.(event);
		if (
			event.defaultPrevented ||
			event.key !== "Enter" ||
			event.repeat ||
			event.nativeEvent.isComposing ||
			!isSubmitOnEnterInput(event.target)
		) {
			return;
		}
		event.preventDefault();
		onSubmit();
	};
	return <div {...props} role="form" aria-label={label} onKeyDown={handleKeyDown} />;
}
