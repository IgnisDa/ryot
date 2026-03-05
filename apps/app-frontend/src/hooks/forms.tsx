import { Button, Text, TextInput } from "@mantine/core";
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

function TextField(props: TextFieldProps) {
	const field = useFieldContext<string>();

	return (
		<div>
			<Text component="label" htmlFor={props.id} size="sm" fw={500}>
				{props.label}
			</Text>
			<TextInput
				id={props.id}
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
	fieldComponents: { TextField },
	formComponents: { SubmitButton },
});
