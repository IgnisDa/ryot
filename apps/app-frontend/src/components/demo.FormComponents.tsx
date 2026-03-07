import { useStore } from "@tanstack/react-form";
import {
	Button,
	Select as ReshapedSelect,
	Slider as ReshapedSlider,
	Switch as ReshapedSwitch,
	TextArea as ReshapedTextArea,
	TextField as ReshapedTextField,
	Text,
} from "reshaped";
import { useFieldContext, useFormContext } from "@/hooks/forms";

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
					color="critical"
					weight="bold"
					variant="caption-1"
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
			<ReshapedTextField
				name={props.label}
				placeholder={props.placeholder}
				value={field.state.value}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.value)}
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
			<ReshapedTextArea
				name={props.label}
				value={field.state.value}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.value)}
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
			<ReshapedSelect
				name={props.label}
				placeholder={props.placeholder}
				options={props.values}
				value={field.state.value}
				onChange={(event) => field.handleChange(event.value ?? "")}
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
			<Text weight="bold" variant="featured-3">
				{props.label}
			</Text>
			<ReshapedSlider
				name={props.label}
				value={field.state.value}
				onChange={(event) => field.handleChange(event.value)}
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
			<ReshapedSwitch
				name={props.label}
				checked={field.state.value}
				onBlur={field.handleBlur}
				onChange={(event) => field.handleChange(event.checked)}
			/>
			{field.state.meta.isTouched && <ErrorMessages errors={errors} />}
		</div>
	);
}
