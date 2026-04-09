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
	  }
	| {
			kind: "text";
			label: string;
			required: boolean;
			placeholder?: string;
			inputType?: HTMLInputTypeAttribute;
	  }
	| {
			label: string;
			kind: "number";
			required: boolean;
			placeholder?: string;
	  }
	| {
			label: string;
			kind: "select";
			required: boolean;
			placeholder?: string;
			options: [string, ...string[]];
	  }
	| {
			label: string;
			required: boolean;
			kind: "multiselect";
			options: [string, ...string[]];
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
	SelectField: ComponentType<{
		label: string;
		data: string[];
		required?: boolean;
		disabled?: boolean;
		placeholder?: string;
	}>;
	MultiSelectField: ComponentType<{
		label: string;
		data: string[];
		required?: boolean;
		disabled?: boolean;
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
	_propertyKey: string,
	propertyDef: AppPropertyDefinition,
	options: GeneratedPropertyFieldOptions = {},
): GeneratedPropertyFieldConfig | null {
	const label = propertyDef.label;
	const required = isAppPropertyRequired(propertyDef);

	return match(propertyDef)
		.with({ type: "boolean" }, () => ({
			label,
			required,
			kind: "checkbox" as const,
		}))
		.with({ type: "date" }, () => ({
			label,
			required,
			kind: "text" as const,
			inputType: "date" as const,
		}))
		.with({ type: "datetime" }, () => ({
			label,
			required,
			kind: "text" as const,
			placeholder: "2026-03-27T14:30:00Z",
		}))
		.with({ type: "integer" }, () => ({
			label,
			required,
			kind: "number" as const,
			placeholder: `Enter ${label}`,
		}))
		.with({ type: "number" }, () => ({
			label,
			required,
			kind: "number" as const,
			placeholder: `Enter ${label}`,
		}))
		.with({ type: "string" }, () => ({
			label,
			required,
			kind: "text" as const,
			placeholder: `Enter ${label}`,
		}))
		.with({ type: "enum" }, (p) => ({
			label,
			required,
			options: p.options,
			kind: "select" as const,
			placeholder: `Select ${label}`,
		}))
		.with({ type: "enum-array" }, (p) => ({
			label,
			required,
			options: p.options,
			kind: "multiselect" as const,
		}))
		.otherwise(() => {
			if (options.fallback === "text") {
				return {
					label,
					required,
					kind: "text" as const,
					placeholder: `Enter ${label}`,
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
				match(config)
					.with({ kind: "checkbox" }, (cfg) => (
						<field.CheckboxField
							label={cfg.label}
							required={cfg.required}
							disabled={props.disabled}
						/>
					))
					.with({ kind: "number" }, (cfg) => (
						<field.NumberField
							label={cfg.label}
							required={cfg.required}
							disabled={props.disabled}
							placeholder={cfg.placeholder}
						/>
					))
					.with({ kind: "text" }, (cfg) => (
						<field.TextField
							label={cfg.label}
							type={cfg.inputType}
							required={cfg.required}
							disabled={props.disabled}
							placeholder={cfg.placeholder}
						/>
					))
					.with({ kind: "select" }, (cfg) => (
						<field.SelectField
							label={cfg.label}
							data={cfg.options}
							required={cfg.required}
							disabled={props.disabled}
							placeholder={cfg.placeholder}
						/>
					))
					.with({ kind: "multiselect" }, (cfg) => (
						<field.MultiSelectField
							label={cfg.label}
							data={cfg.options}
							required={cfg.required}
							disabled={props.disabled}
						/>
					))
					.exhaustive()
			}
		</props.form.AppField>
	);
}
