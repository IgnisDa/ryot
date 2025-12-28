import {
	type AppPropertyDefinition,
	isAppPropertyRequired,
} from "@ryot/ts-utils";
import type { ComponentType, HTMLInputTypeAttribute, ReactNode } from "react";
import { match } from "ts-pattern";

type GeneratedPropertyFieldConfig =
	| {
			label: string;
			kind: "checkbox";
			required: boolean;
			placeholder?: string;
			inputType?: HTMLInputTypeAttribute;
	  }
	| {
			label: string;
			required: boolean;
			placeholder?: string;
			kind: "number" | "text";
			inputType?: HTMLInputTypeAttribute;
	  };

type GeneratedPropertyFieldOptions = {
	fallback?: "omit" | "text";
};

type GeneratedPropertyFieldRenderProps = {
	CheckboxField: ComponentType<{
		label: string;
		required?: boolean;
		disabled?: boolean;
	}>;
	NumberField: ComponentType<{
		label: string;
		disabled?: boolean;
		required?: boolean;
		placeholder?: string;
	}>;
	TextField: ComponentType<{
		label: string;
		required?: boolean;
		disabled?: boolean;
		placeholder?: string;
		type?: HTMLInputTypeAttribute;
	}>;
};

type GeneratedPropertyFieldProps = {
	disabled: boolean;
	propertyKey: string;
	propertyDef: AppPropertyDefinition;
	options?: GeneratedPropertyFieldOptions;
	form: {
		AppField: ComponentType<{
			children: (field: GeneratedPropertyFieldRenderProps) => ReactNode;
			name: `properties.${string}`;
		}>;
	};
};

export function getGeneratedPropertyFieldConfig(
	propertyKey: string,
	propertyDef: AppPropertyDefinition,
	options: GeneratedPropertyFieldOptions = {},
): GeneratedPropertyFieldConfig | null {
	const label = propertyKey;
	const required = isAppPropertyRequired(propertyDef);

	return match(propertyDef.type)
		.with("boolean", () => ({ kind: "checkbox" as const, label, required }))
		.with("date", () => ({
			label,
			required,
			kind: "text" as const,
			inputType: "date" as const,
		}))
		.with("datetime", () => ({
			label,
			required,
			kind: "text" as const,
			placeholder: "2026-03-27T14:30:00Z",
		}))
		.with("integer", () => ({
			label,
			required,
			kind: "number" as const,
			placeholder: `Enter ${propertyKey}`,
		}))
		.with("number", () => ({
			label,
			required,
			kind: "number" as const,
			placeholder: `Enter ${propertyKey}`,
		}))
		.with("string", () => ({
			label,
			required,
			kind: "text" as const,
			placeholder: `Enter ${propertyKey}`,
		}))
		.otherwise(() => {
			if (options.fallback === "text") {
				return {
					label,
					required,
					kind: "text" as const,
					placeholder: `Enter ${propertyKey}`,
				};
			}

			return null;
		});
}

export function GeneratedPropertyField(props: GeneratedPropertyFieldProps) {
	const config = getGeneratedPropertyFieldConfig(
		props.propertyKey,
		props.propertyDef,
		props.options,
	);
	if (!config) {
		return null;
	}

	const fieldName = `properties.${props.propertyKey}` as const;

	return (
		<props.form.AppField name={fieldName}>
			{(field) =>
				match(config.kind)
					.with("checkbox", () => (
						<field.CheckboxField
							label={config.label}
							disabled={props.disabled}
							required={config.required}
						/>
					))
					.with("number", () => (
						<field.NumberField
							label={config.label}
							disabled={props.disabled}
							required={config.required}
							placeholder={config.placeholder}
						/>
					))
					.with("text", () => (
						<field.TextField
							label={config.label}
							type={config.inputType}
							disabled={props.disabled}
							required={config.required}
							placeholder={config.placeholder}
						/>
					))
					.exhaustive()
			}
		</props.form.AppField>
	);
}
