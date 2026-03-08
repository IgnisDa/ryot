import { Button, Checkbox, NumberInput, Text, TextInput } from "@mantine/core";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { HTMLInputTypeAttribute } from "react";

type TextFieldProps = {
	id?: string;
	label: string;
	required?: boolean;
	disabled?: boolean;
	className?: string;
	placeholder?: string;
	autoComplete?: string;
	type?: HTMLInputTypeAttribute;
};

export function normalizeNumberInputValue(value: number | string) {
	if (typeof value === "number") return value;
	if (value.trim() === "") return value;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

	return value;
}

function TextField(props: TextFieldProps) {
	const field = useFieldContext<string>();

	return (
		<div>
			<TextInput
				id={props.id}
				label={props.label}
				required={props.required}
				disabled={props.disabled}
				value={field.state.value}
				onBlur={field.handleBlur}
				className={props.className}
				type={props.type ?? "text"}
				placeholder={props.placeholder}
				error={!field.state.meta.isValid}
				autoComplete={props.autoComplete}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type NumberFieldProps = {
	id?: string;
	label: string;
	required?: boolean;
	disabled?: boolean;
	className?: string;
	placeholder?: string;
};

function NumberField(props: NumberFieldProps) {
	const field = useFieldContext<number | string>();

	return (
		<div>
			<NumberInput
				id={props.id}
				label={props.label}
				required={props.required}
				disabled={props.disabled}
				value={field.state.value}
				onBlur={field.handleBlur}
				className={props.className}
				placeholder={props.placeholder}
				error={!field.state.meta.isValid}
				onChange={(value) =>
					field.handleChange(normalizeNumberInputValue(value))
				}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type CheckboxFieldProps = {
	label: string;
	required?: boolean;
	disabled?: boolean;
};

function CheckboxField(props: CheckboxFieldProps) {
	const field = useFieldContext<boolean>();

	return (
		<div>
			<Checkbox
				label={props.label}
				required={props.required}
				disabled={props.disabled}
				onBlur={field.handleBlur}
				checked={field.state.value}
				onChange={(event) => field.handleChange(event.currentTarget.checked)}
			/>
			{!field.state.meta.isValid && (
				<Text c="red" size="xs">
					{field.state.meta.errors.map((e) => e?.message).join(", ")}
				</Text>
			)}
		</div>
	);
}

type SubmitButtonProps = {
	label: string;
	variant?: string;
	disabled?: boolean;
	fullWidth?: boolean;
	pendingLabel?: string;
};

function SubmitButton(props: SubmitButtonProps) {
	const form = useFormContext();

	return (
		<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
			{([canSubmit, isSubmitting]) => (
				<Button
					type="submit"
					variant={props.variant}
					fullWidth={props.fullWidth}
					disabled={props.disabled || isSubmitting || !canSubmit}
				>
					{isSubmitting ? (props.pendingLabel ?? props.label) : props.label}
				</Button>
			)}
		</form.Subscribe>
	);
}

export const { fieldContext, useFieldContext, formContext, useFormContext } =
	createFormHookContexts();

export const { useAppForm } = createFormHook({
	formContext,
	fieldContext,
	formComponents: { SubmitButton },
	fieldComponents: { CheckboxField, NumberField, TextField },
});
