import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentProps, Ref } from "react";
import type { TextInputProps } from "react-native";

import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Input, InputField } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

import { resolveError } from "./form-utils";

type TextFieldProps = Pick<
	ComponentProps<typeof InputField>,
	| "placeholder"
	| "autoCorrect"
	| "autoComplete"
	| "keyboardType"
	| "returnKeyType"
	| "autoCapitalize"
	| "secureTextEntry"
	| "submitBehavior"
	| "blurOnSubmit"
	| "onSubmitEditing"
> & {
	inputRef?: Ref<TextInputProps>;
};

function TextField(props: TextFieldProps) {
	const field = useFieldContext<string>();
	const { inputRef, ...inputProps } = props;
	return (
		<Box className="gap-1">
			<Input>
				<InputField
					{...inputProps}
					ref={inputRef}
					value={field.state.value}
					onBlur={field.handleBlur}
					onChangeText={field.handleChange}
				/>
			</Input>
			{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
				<Text className="text-destructive text-xs">
					{field.state.meta.errors.map(resolveError).filter(Boolean).join(", ")}
				</Text>
			)}
		</Box>
	);
}

type SubmitButtonProps = {
	label: string;
	disabled?: boolean;
	pendingLabel?: string;
};

function SubmitButton(props: SubmitButtonProps) {
	const form = useFormContext();
	return (
		<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
			{([canSubmit, isSubmitting]) => (
				<Button
					onPress={() => void form.handleSubmit()}
					disabled={(props.disabled ?? false) || isSubmitting || !canSubmit}
				>
					{isSubmitting && <ButtonSpinner />}
					<ButtonText>
						{isSubmitting ? (props.pendingLabel ?? props.label) : props.label}
					</ButtonText>
				</Button>
			)}
		</form.Subscribe>
	);
}

const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();

export const { useAppForm } = createFormHook({
	formContext,
	fieldContext,
	fieldComponents: { TextField },
	formComponents: { SubmitButton },
});
