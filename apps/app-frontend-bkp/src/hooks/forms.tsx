import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentPropsWithoutRef, HTMLInputTypeAttribute } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GetErrorMessage = (errors: Array<unknown>) => string | null;

type TextFieldProps = {
	id?: string;
	label: string;
	className?: string;
	placeholder?: string;
	autoComplete?: string;
	type?: HTMLInputTypeAttribute;
	getErrorMessage?: GetErrorMessage;
};

type SubmitButtonProps = {
	label: string;
	className?: string;
	disabled?: boolean;
	pendingLabel?: string;
} & Pick<ComponentPropsWithoutRef<typeof Button>, "variant">;

function TextField(props: TextFieldProps) {
	const field = useFieldContext<string>();
	const errorMessage = field.state.meta.isTouched
		? (props.getErrorMessage?.(field.state.meta.errors) ?? null)
		: null;

	return (
		<div className="space-y-2">
			<Label htmlFor={props.id}>{props.label}</Label>
			<Input
				id={props.id}
				value={field.state.value}
				onBlur={field.handleBlur}
				className={props.className}
				type={props.type ?? "text"}
				placeholder={props.placeholder}
				autoComplete={props.autoComplete}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
			{errorMessage ? (
				<p className="text-destructive text-xs">{errorMessage}</p>
			) : null}
		</div>
	);
}

function SubmitButton(props: SubmitButtonProps) {
	const form = useFormContext();

	return (
		<form.Subscribe selector={(state) => state.isSubmitting}>
			{(isSubmitting) => (
				<Button
					type="submit"
					variant={props.variant}
					className={props.className}
					disabled={props.disabled || isSubmitting}
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
