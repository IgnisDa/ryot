import {
	ActionForm,
	Button,
	Dialog,
	Field,
	FieldMessage,
	Select,
	StatusMessage,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useRef, useState, type RefObject } from "react";

import type { MeasurementEntry } from "../../shared/measurement-reading-operations";
import { DateTimeField } from "../datetime-field";
import { resolveDateTimeInput, toDateTimeInput } from "../datetime-input";
import { unitSuffix } from "./model";

type ComposerMetric = { readonly id: string; readonly name: string; readonly unit: string | null };

type MeasurementDraft = {
	readonly comment: string | null;
	readonly occurredAt: string;
	readonly values: readonly { readonly metricId: string; readonly value: number | null }[];
};

const parseValue = (text: string) => {
	const trimmed = text.trim();
	if (trimmed === "") {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : undefined;
};

function MetricValueField(props: {
	readonly text: string;
	readonly invalid: boolean;
	readonly onRemove: () => void;
	readonly metric: ComposerMetric;
	readonly onChange: (text: string) => void;
}) {
	const { text, metric, invalid } = props;
	return (
		<li>
			<Field
				error={invalid ? "Enter a number." : undefined}
				label={`${metric.name}${unitSuffix(metric.unit)}`}
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
							aria-label={`Remove ${metric.name}`}
						>
							<AppIcon name="x" size={16} />
						</Button>
					</div>
				)}
			</Field>
		</li>
	);
}

export function MeasurementDialog(props: {
	readonly label: string;
	readonly pending: boolean;
	readonly retained?: boolean;
	readonly onRetry?: () => void;
	readonly submitLabel: string;
	readonly pendingLabel: string;
	readonly onClose: () => void;
	readonly onChange: () => void;
	readonly initial: MeasurementDraft;
	readonly errorMessage: string | undefined;
	readonly metrics: readonly ComposerMetric[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
	readonly onSubmit: (readings: MeasurementEntry) => void;
}) {
	const {
		label,
		initial,
		metrics,
		pending,
		onClose,
		onChange,
		onSubmit,
		triggerRef,
		submitLabel,
		errorMessage,
		pendingLabel,
	} = props;
	const occurredAtRef = useRef<HTMLInputElement>(null);
	const [occurredAt, setOccurredAt] = useState(() => toDateTimeInput(initial.occurredAt));
	const [occurrence, setOccurrence] = useState<string>();
	const timestamp = resolveDateTimeInput(occurredAt, initial.occurredAt, occurrence);
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
		message = "Enter at least one value.";
	}
	const change = (update: () => void) => {
		update();
		onChange();
	};
	const save = () => {
		if (props.retained) {
			props.onRetry?.();
			return;
		}
		setSubmitted(true);
		if (
			timestamp.iso === null ||
			values.length === 0 ||
			parsed.some(({ value }) => value === undefined)
		) {
			return;
		}
		onSubmit({ values, comment: comment.trim(), occurredAt: timestamp.iso });
	};
	let actionLabel = submitLabel;
	if (pending) {
		actionLabel = pendingLabel;
	} else if (props.retained) {
		actionLabel = "Retry save";
	}
	return (
		<Dialog
			title={label}
			onClose={onClose}
			dismissible={!pending}
			triggerRef={triggerRef}
			initialFocusRef={occurredAtRef}
			closeLabel={`Close ${label.toLowerCase()}`}
			footer={
				<>
					<Button type="button" onClick={onClose} disabled={pending} variant="secondary">
						Cancel
					</Button>
					<Button type="button" onClick={save} disabled={pending}>
						{actionLabel}
					</Button>
				</>
			}
		>
			<ActionForm label={label} onSubmit={save} className="flex flex-col gap-4">
				<fieldset className="flex flex-col gap-4" disabled={pending || props.retained}>
					<DateTimeField
						value={occurredAt}
						label="Date and time"
						showError={submitted}
						resolution={timestamp}
						inputRef={occurredAtRef}
						onOccurrenceChange={(value) => change(() => setOccurrence(value))}
						onChange={(value) =>
							change(() => {
								setOccurredAt(value);
								setOccurrence(undefined);
							})
						}
					/>
					<ul aria-label="Values" className="flex flex-col gap-3">
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
												change(() =>
													setEntries((current) =>
														current.filter(({ metricId }) => metricId !== entry.metricId),
													),
												)
											}
											onChange={(text) =>
												change(() =>
													setEntries((current) =>
														current.map((candidate) =>
															candidate.metricId === entry.metricId
																? { ...candidate, text }
																: candidate,
														),
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
							label="Add metric value"
							placeholder="Add metric value"
							checkIcon={<AppIcon size={14} name="check" />}
							searchIcon={<AppIcon size={14} name="search" />}
							chevronIcon={<AppIcon size={14} name="chevron-down" />}
							onChange={(metricId) =>
								change(() => setEntries((current) => [...current, { metricId, text: "" }]))
							}
							choices={metrics
								.filter(({ id }) => !shownIds.has(id))
								.map(({ id, name }) => ({ value: id, label: name }))}
						/>
					)}
					<Field optional label="Comment">
						{(control) => (
							<TextArea
								{...control}
								rows={2}
								value={comment}
								onChange={(event) => change(() => setComment(event.target.value))}
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
