import { Effect, Result, Schema } from "@ryot-app/plugin-client-sdk/effect";
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
import { useFitnessMessages } from "../messages";

const createMetricMutation = createRyotMutation<
	MeasurementMetricCreateInput,
	typeof MeasurementMetricCreateOutput.Type
>(({ input, client }) =>
	client.operations
		.invoke({
			input,
			packageId: PLUGIN_PACKAGE_ID,
			output: MeasurementMetricCreateOutput,
			inputSchema: MeasurementMetricCreateInput,
			slug: measurementMetricCreateOperationSlug,
		})
		.pipe(Effect.map(({ output }) => output)),
);

export function AddMetricDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useFitnessMessages();
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
		nameError = text("client.measurements.add.duplicate");
	} else if (submitted && key.length === 0) {
		nameError = text("client.measurements.add.name-required");
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
			initialFocusRef={nameRef}
			triggerRef={props.triggerRef}
			dismissible={!create.isPending}
			title={text("client.measurements.add-metric")}
			closeLabel={text("client.measurements.add.close")}
			footer={
				<>
					<Button onClick={onClose} variant="secondary" disabled={create.isPending}>
						{text("common.action.cancel")}
					</Button>
					<Button onClick={save} disabled={create.isPending || duplicate}>
						{create.isPending
							? text("client.measurements.add.pending")
							: text("client.measurements.add-metric")}
					</Button>
				</>
			}
		>
			<ActionForm
				onSubmit={save}
				className="flex flex-col gap-4"
				label={text("client.measurements.add-metric")}
			>
				<fieldset disabled={create.isPending} className="flex flex-col gap-4">
					<Field error={nameError} label={text("client.measurements.add.name")}>
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
						label={text("property.unit")}
						hint={
							canonicalUnit === undefined
								? undefined
								: text("client.measurements.add.unit-hint", { unit: canonicalUnit })
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
					<StatusMessage tone="error">{text("client.measurements.add.failed")}</StatusMessage>
				)}
			</ActionForm>
		</Dialog>
	);
}
