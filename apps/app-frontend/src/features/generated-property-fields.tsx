import {
	type AppPropertyDefinition,
	isAppPropertyRequired,
} from "@ryot/ts-utils";
import type { ComponentType, HTMLInputTypeAttribute, ReactNode } from "react";

type GeneratedPropertyFieldConfig =
	| {
			label: string;
			kind: "checkbox";
			required: boolean;
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

	switch (propertyDef.type) {
		case "boolean":
			return { kind: "checkbox", label, required };
		case "date":
			return { kind: "text", label, required, inputType: "date" };
		case "integer":
		case "number":
			return {
				label,
				required,
				kind: "number",
				placeholder: `Enter ${propertyKey}`,
			};
		case "string":
			return {
				label,
				required,
				kind: "text",
				placeholder: `Enter ${propertyKey}`,
			};
		default:
			if (options.fallback === "text") {
				return {
					label,
					required,
					kind: "text",
					placeholder: `Enter ${propertyKey}`,
				};
			}

			return null;
	}
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
			{(field) => {
				switch (config.kind) {
					case "checkbox":
						return (
							<field.CheckboxField
								label={config.label}
								required={config.required}
								disabled={props.disabled}
							/>
						);
					case "number":
						return (
							<field.NumberField
								label={config.label}
								disabled={props.disabled}
								required={config.required}
								placeholder={config.placeholder}
							/>
						);
					case "text":
						return (
							<field.TextField
								label={config.label}
								type={config.inputType}
								disabled={props.disabled}
								required={config.required}
								placeholder={config.placeholder}
							/>
						);
				}
			}}
		</props.form.AppField>
	);
}
