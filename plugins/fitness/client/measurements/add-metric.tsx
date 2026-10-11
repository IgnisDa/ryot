import { RyotClientError } from "@ryot-app/client-sdk";
import { Effect, Result, Schema } from "@ryot-app/client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/client-sdk/react";
import { Button, FieldMessage, Modal, StatusMessage, TextField } from "@ryot-app/client-ui-sdk";
import { useId, useRef, useState, type RefObject } from "react";

import {
	MeasurementMetricCreateInput,
	MeasurementMetricCreateOutput,
	measurementMetricCreateOperationSlug,
} from "../../shared/measurement-metric-operations";
import { measurementMetricKey, measurementMetricUnit } from "../../shared/measurement-metrics";
import type { MeasurementSummary } from "../../shared/measurement-recipes";

const createMetricMutation = createRyotMutation<
	{ readonly metric: MeasurementMetricCreateInput; readonly onCreated: () => void },
	typeof MeasurementMetricCreateOutput.Type
>(({ client, input: { metric, onCreated } }) =>
	Schema.encodeEffect(Schema.toCodecJson(MeasurementMetricCreateInput))(metric).pipe(
		Effect.mapError(() => new RyotClientError("invalid-input")),
		Effect.flatMap((input) =>
			client.operations.invoke({
				input,
				pluginSlug: "fitness",
				output: MeasurementMetricCreateOutput,
				slug: measurementMetricCreateOperationSlug,
			}),
		),
		Effect.tap(() => Effect.sync(onCreated)),
	),
);

export function AddMetricDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const nameId = useId();
	const unitId = useId();
	const nameErrorId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [unit, setUnit] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const create = useRyotMutation(createMetricMutation);
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
			create.mutate({ metric: metric.success, onCreated: props.onClose });
		}
	};
	return (
		<Modal
			label="Add metric"
			onClose={props.onClose}
			initialFocusRef={nameRef}
			triggerRef={props.triggerRef}
			closeLabel="Close add metric"
			dismissible={!create.isPending}
			containerClassName="items-center justify-center p-4"
			className="w-full max-w-md rounded-xl border border-border bg-raised p-5 font-ui"
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					save();
				}}
			>
				<h2 className="font-display text-xl font-semibold text-text">Add metric</h2>
				<fieldset disabled={create.isPending} className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<label htmlFor={nameId} className="text-sm font-medium text-text">
							Name
						</label>
						<TextField
							id={nameId}
							value={name}
							ref={nameRef}
							invalid={nameError !== undefined}
							aria-describedby={nameError === undefined ? undefined : nameErrorId}
							onChange={(event) => {
								setName(event.target.value);
								create.reset();
							}}
						/>
						{nameError === undefined ? null : (
							<FieldMessage id={nameErrorId}>{nameError}</FieldMessage>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<label htmlFor={unitId} className="text-sm font-medium text-text">
							Unit (optional)
						</label>
						<TextField
							id={unitId}
							value={canonicalUnit ?? unit}
							readOnly={canonicalUnit !== undefined}
							onChange={(event) => {
								setUnit(event.target.value);
								create.reset();
							}}
						/>
						{canonicalUnit === undefined ? null : (
							<p className="text-sm text-text-muted">
								This metric uses {canonicalUnit} to match OpenScale imports.
							</p>
						)}
					</div>
				</fieldset>
				{create.error === null ? null : (
					<StatusMessage tone="error">The metric couldn't be added. Try again.</StatusMessage>
				)}
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="secondary"
						onClick={props.onClose}
						disabled={create.isPending}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={create.isPending || duplicate}>
						{create.isPending ? "Adding…" : "Add metric"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
