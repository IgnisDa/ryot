import { Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	Dialog,
	Field,
	StatusMessage,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { type RefObject, useEffect, useRef, useState } from "react";

import {
	MeasurementMetricCreateInput,
	measurementMetricCreateOperationSlug,
	MeasurementMetricCreateOutput,
} from "../../shared/measurement-metric-operations";
import { measurementMetricKey, measurementMetricUnit } from "../../shared/measurement-metrics";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const createMetricMutation = createRyotMutation<
	MeasurementMetricCreateInput,
	typeof MeasurementMetricCreateOutput.Type
>(({ input, client }) =>
	client.operations.invoke({
		input,
		packageId: PLUGIN_PACKAGE_ID,
		output: MeasurementMetricCreateOutput,
		inputSchema: MeasurementMetricCreateInput,
		slug: measurementMetricCreateOperationSlug,
	}),
);

export function AddMetricDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const { onClose } = props;
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [unit, setUnit] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const create = useRyotMutation(createMetricMutation);
	useEffect(() => {
		if (create.data !== undefined) {
			onClose();
		}
	}, [create.data, onClose]);
	const key = measurementMetricKey(name);
	const canonicalUnit = measurementMetricUnit(key);
	const duplicate = key.length > 0 && props.metrics.some((metric) => metric.key === key);
	let nameError: string | undefined;
	if (duplicate) {
		nameError = "This metric already exists. Choose a different name.";
	} else if (submitted && key.length === 0) {
		nameError = "Enter a name with at least one letter from A–Z or a number.";
	}
	const save = () => {
		setSubmitted(true);
		const metric = Schema.decodeResult(MeasurementMetricCreateInput)({
			name,
			unit: canonicalUnit ?? unit,
		});
		if (!duplicate && Result.isSuccess(metric)) {
			create.mutate(metric.success);
		}
	};
	return (
		<Dialog
			onClose={onClose}
			title="Add metric"
			initialFocusRef={nameRef}
			triggerRef={props.triggerRef}
			closeLabel="Close add metric"
			dismissible={!create.isPending}
			footer={
				<>
					<Button onClick={onClose} variant="secondary" disabled={create.isPending}>
						Cancel
					</Button>
					<Button onClick={save} disabled={create.isPending || duplicate}>
						{create.isPending ? "Adding…" : "Add metric"}
					</Button>
				</>
			}
		>
			<ActionForm onSubmit={save} label="Add metric" className="flex flex-col gap-4">
				<fieldset disabled={create.isPending} className="flex flex-col gap-4">
					<Field label="Name" error={nameError}>
						{(control) => (
							<TextField
								{...control}
								value={name}
								ref={nameRef}
								onChange={(event) => {
									setName(event.target.value);
									create.reset();
								}}
							/>
						)}
					</Field>
					<Field
						optional
						label="Unit"
						hint={
							canonicalUnit === undefined
								? undefined
								: `This metric uses ${canonicalUnit} to match OpenScale imports.`
						}
					>
						{(control) => (
							<TextField
								{...control}
								value={canonicalUnit ?? unit}
								readOnly={canonicalUnit !== undefined}
								onChange={(event) => {
									setUnit(event.target.value);
									create.reset();
								}}
							/>
						)}
					</Field>
				</fieldset>
				{create.error === null ? null : (
					<StatusMessage tone="error">The metric couldn't be added. Try again.</StatusMessage>
				)}
			</ActionForm>
		</Dialog>
	);
}
