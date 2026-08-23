import clsx from "clsx";
import type { ComponentProps } from "react";

export { Menu } from "./menu";
export { Chip } from "./chips";
export { Badge } from "./badge";
export { Modal } from "./modal";
export { Switch } from "./switch";
export { Select } from "./select";
export type { MenuItem } from "./menu";
export { useFieldEscape } from "./field-escape";
export { RadioGroup } from "./radio-group";
export { MultiSelect } from "./multi-select";
export type { SelectChoice } from "./select";
export { SearchField } from "./search-field";
export { ReorderableList } from "./reorderable-list";
export type { RadioGroupOption } from "./radio-group";
export { FieldMessage, TextField } from "./text-field";
export { SegmentedControl } from "./segmented-control";
export { ScreenBarButton, ScreenFrame } from "./screen-frame";
export type { MultiSelectChoice } from "./multi-select";
export { useFocusTrap, useScrollLock, useRestoreFocus, useDismissOnOutside } from "./overlay";
export { OverlayBackProvider, OverlayScope, useShortcut } from "./shortcut";
export type { OverlayBackAdapter } from "./shortcut";

const variantClasses = {
	text: "min-h-10 font-semibold text-text-muted",
	secondary: "min-h-11 rounded-lg border border-border-strong px-4 py-2.5 font-semibold text-text",
	primary:
		"min-h-11 rounded-lg border border-accent-deep bg-accent px-4 py-2.5 font-semibold text-accent-ink",
	switch:
		"min-h-9.5 rounded-md font-semibold text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm",
} as const;

type ButtonProps = ComponentProps<"button"> & {
	variant?: keyof typeof variantClasses;
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
	return <button className={clsx(variantClasses[variant], className)} {...props} />;
}

const toneClasses = {
	error: "text-danger",
	success: "text-success",
	pending: "text-text-muted",
} as const;

type StatusMessageProps = ComponentProps<"p"> & {
	tone: keyof typeof toneClasses;
};

export function StatusMessage({ className, tone, ...props }: StatusMessageProps) {
	return (
		<p
			role={tone === "error" ? "alert" : "status"}
			className={clsx(toneClasses[tone], className)}
			{...props}
		/>
	);
}
