import { useDisplayText } from "@ryot-app/plugin-client-sdk/react";
import type { Text } from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	DateTimeField,
	Dialog,
	Field,
	FieldMessage,
	Select,
	StatusMessage,
	TextArea,
	TextField,
	useDateTimeInput,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type RefObject, useRef, useState } from "react";

import type { MeasurementEntry } from "../../shared/measurement-reading-operations";
import { useFitnessMessages } from "../messages";
import { nameWithUnit } from "./model";

type ComposerMetric = { readonly id: string; readonly name: string; readonly unit: null | string };

type MeasurementDraft = {
	readonly occurredAt: string;
	readonly comment: null | string;
	readonly values: readonly { readonly metricId: string; readonly value: null | number }[];
};

const parseValue = (text: string) => {
	const trimmed = text.trim();
	if (trimmed === "") {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : undefined;
};

export function MeasurementDialog(props: {
	readonly label: Text;
	readonly pending: boolean;
	readonly closeLabel: Text;
	readonly pendingLabel: Text;
	readonly submitLabel: string;
	readonly onClose: () => void;
	readonly initial: MeasurementDraft;
	readonly errorMessage: Text | undefined;
	readonly metrics: readonly ComposerMetric[];
	readonly onSubmit: (readings: MeasurementEntry) => void;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const displayText = useDisplayText();
	const text = useFitnessMessages();
	const {
		label,
		initial,
		metrics,
		pending,
		onClose,
		onSubmit,
		triggerRef,
		closeLabel,
		submitLabel,
		errorMessage,
		pendingLabel,
	} = props;
	const occurredAtRef = useRef<HTMLInputElement>(null);
	const timestamp = useDateTimeInput(initial.occurredAt);
	const [comment, setComment] = useState(initial.comment ?? "");
	const [entries, setEntries] = useState(() =>
		initial.values.map(({ value, metricId }) => ({
			metricId,
			text: value === null ? "" : String(value),
		})),
	);
	const [submitted, setSubmitted] = useState(false);
	const shownIds = new Set(entries.map(({ metricId }) => metricId));
	const parsed = entries.map((entry) => ({ ...entry, value: parseValue(entry.text) }));
	const values = parsed.flatMap(({ value, metricId }) =>
		value === null || value === undefined ? [] : [{ value, metricId }],
	);
	let message: string | undefined;
	if (submitted && values.length === 0 && parsed.every(({ value }) => value !== undefined)) {
		message = text("client.measurements.composer.value-required");
	}
	const save = () => {
		setSubmitted(true);
		if (
			timestamp.resolution.iso === null ||
			values.length === 0 ||
			parsed.some(({ value }) => value === undefined)
		) {
			return;
		}
		onSubmit({ values, comment: comment.trim(), occurredAt: timestamp.resolution.iso });
	};
	const actionLabel = pending ? pendingLabel : submitLabel;
	return (
		<Dialog
			title={label}
			onClose={onClose}
			dismissible={!pending}
			triggerRef={triggerRef}
			closeLabel={closeLabel}
			initialFocusRef={occurredAtRef}
			footer={
				<>
					<Button type="button" onClick={onClose} disabled={pending} variant="secondary">
						{text("common.action.cancel")}
					</Button>
					<Button type="button" onClick={save} disabled={pending}>
						{actionLabel}
					</Button>
				</>
			}
		>
			<ActionForm label={label} onSubmit={save} className="flex flex-col gap-4">
				<fieldset disabled={pending} className="flex flex-col gap-4">
					<DateTimeField
						{...timestamp}
						showError={submitted}
						inputRef={occurredAtRef}
						checkIcon={<AppIcon size={14} name="check" />}
						onChange={(value) => timestamp.onChange(value)}
						label={text("client.measurements.composer.date-time")}
						chevronIcon={<AppIcon size={14} name="chevron-down" />}
						onOccurrenceChange={(value) => timestamp.onOccurrenceChange(value)}
					/>
					<ul
						className="flex flex-col gap-3"
						aria-label={text("client.measurements.composer.values")}
					>
						{entries.flatMap((entry, index) => {
							const metric = metrics.find(({ id }) => id === entry.metricId);
							return metric === undefined
								? []
								: [
										<MetricValueField
											metric={metric}
											text={entry.text}
											key={entry.metricId}
											invalid={submitted && parsed[index]?.value === undefined}
											onRemove={() =>
												setEntries((current) =>
													current.filter(({ metricId }) => metricId !== entry.metricId),
												)
											}
											onChange={(value) =>
												setEntries((current) =>
													current.map((candidate) =>
														candidate.metricId === entry.metricId
															? { ...candidate, text: value }
															: candidate,
													),
												)
											}
										/>,
									];
						})}
					</ul>
					{metrics.length === shownIds.size ? null : (
						<Select
							value=""
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							label={text("client.measurements.composer.add-value")}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							placeholder={text("client.measurements.composer.add-value")}
							onChange={(metricId) => setEntries((current) => [...current, { metricId, text: "" }])}
							choices={metrics
								.filter(({ id }) => !shownIds.has(id))
								.map(({ id, name }) => ({ value: id, label: displayText(name) }))}
						/>
					)}
					<Field optional label={text("property.comment")}>
						{(control) => (
							<TextArea
								{...control}
								rows={2}
								value={comment}
								onChange={(event) => setComment(event.target.value)}
							/>
						)}
					</Field>
				</fieldset>
				{message === undefined ? null : <FieldMessage>{message}</FieldMessage>}
				{errorMessage === undefined ? null : (
					<StatusMessage tone="error">{errorMessage}</StatusMessage>
				)}
			</ActionForm>
		</Dialog>
	);
}

function MetricValueField(props: {
	readonly text: string;
	readonly invalid: boolean;
	readonly onRemove: () => void;
	readonly metric: ComposerMetric;
	readonly onChange: (text: string) => void;
}) {
	const messages = useFitnessMessages();
	const { text, metric, invalid } = props;
	return (
		<li>
			<Field
				label={nameWithUnit(messages, metric.name, metric.unit)}
				error={invalid ? messages("client.measurements.composer.number-required") : undefined}
			>
				{(control) => (
					<div className="flex items-center gap-2">
						<TextField
							{...control}
							value={text}
							inputMode="decimal"
							className="min-w-0 flex-1"
							onChange={(event) => props.onChange(event.target.value)}
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={props.onRemove}
							aria-label={messages("client.picker.remove", { name: metric.name })}
						>
							<AppIcon name="x" size={16} />
						</Button>
					</div>
				)}
			</Field>
		</li>
	);
}
