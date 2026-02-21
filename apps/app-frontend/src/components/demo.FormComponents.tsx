import {
	Button,
	Select as MantineSelect,
	Slider as MantineSlider,
	Switch as MantineSwitch,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import { useStore } from "@tanstack/react-form";
import { useFieldContext, useFormContext } from "#/hooks/demo.form-context";

export function SubscribeButton(props: { label: string }) {
	const form = useFormContext();
	return (
		<form.Subscribe selector={(state) => state.isSubmitting}>
			{(isSubmitting) => (
				<Button type="submit" disabled={isSubmitting}>
					{props.label}
				</Button>
			)}
		</form.Subscribe>
	);
}

function ErrorMessages(props: { errors: Array<string | { message: string }> }) {
	return (
		<>
			{props.errors.map((error) => (
				<Text
					key={typeof error === "string" ? error : error.message}
					c="red"
					fw="bold"
					size="sm"
					mt={4}
				>
					{typeof error === "string" ? error : error.message}
				</Text>
			))}
		</>
	);
}

export function TextField(props: { label: string; placeholder?: string }) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);

	return (
		<div>
			<TextInput
				label={props.label}
				placeholder={props.placeholder}
				value={field.state.value}
				onBlur={field.handleBlur}
				onChange={(e) => field.handleChange(e.currentTarget.value)}
			/>
			{field.state.meta.isTouched && <ErrorMessages errors={errors} />}
		</div>
	);
}

export function TextArea(props: { label: string; rows?: number }) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);

	return (
		<div>
			<Textarea
				label={props.label}
				rows={props.rows ?? 3}
				value={field.state.value}
				onBlur={field.handleBlur}
				onChange={(e) => field.handleChange(e.currentTarget.value)}
			/>
			{field.state.meta.isTouched && <ErrorMessages errors={errors} />}
		</div>
	);
}

export function Select(props: {
	label: string;
	values: Array<{ label: string; value: string }>;
	placeholder?: string;
}) {
	const field = useFieldContext<string>();
	const errors = useStore(field.store, (state) => state.meta.errors);

	return (
		<div>
			<MantineSelect
				label={props.label}
				placeholder={props.placeholder}
				data={props.values}
				value={field.state.value}
				onChange={(value) => field.handleChange(value ?? "")}
			/>
			{field.state.meta.isTouched && <ErrorMessages errors={errors} />}
		</div>
	);
}

export function Slider(props: { label: string }) {
	const field = useFieldContext<number>();
	const errors = useStore(field.store, (state) => state.meta.errors);

	return (
		<div>
			<Text fw="bold" size="xl" mb={8}>
				{props.label}
			</Text>
			<MantineSlider
				value={field.state.value}
				onChange={(value) => field.handleChange(value)}
				onMouseLeave={field.handleBlur}
			/>
			{field.state.meta.isTouched && <ErrorMessages errors={errors} />}
		</div>
	);
}

export function Switch(props: { label: string }) {
	const field = useFieldContext<boolean>();
	const errors = useStore(field.store, (state) => state.meta.errors);

	return (
		<div>
			<MantineSwitch
				label={props.label}
				checked={field.state.value}
				onBlur={field.handleBlur}
				onChange={(e) => field.handleChange(e.currentTarget.checked)}
			/>
			{field.state.meta.isTouched && <ErrorMessages errors={errors} />}
		</div>
	);
}
