import {
	ActionForm,
	Button,
	FieldMessage,
	Modal,
	Select,
	StatusMessage,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useId, useRef, useState, type RefObject } from "react";

import type { MeasurementEntry } from "../../shared/measurement-reading-operations";

type ComposerMetric = { readonly id: string; readonly name: string; readonly unit: string | null };

type MeasurementDraft = {
	readonly comment: string | null;
	readonly occurredAt: string;
	readonly values: readonly { readonly metricId: string; readonly value: number | null }[];
};

const pad = (part: number) => String(part).padStart(2, "0");

const toDateTimeInput = (iso: string) => {
	const date = new Date(iso);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
	const inputId = useId();
	const errorId = useId();
	const unit = metric.unit === null || metric.unit === "" ? "" : ` (${metric.unit})`;
	return (
		<li className="flex flex-col gap-1.5">
			<label htmlFor={inputId} className="text-sm font-medium text-text">
				{metric.name}
				{unit}
			</label>
			<div className="flex items-center gap-2">
				<TextField
					id={inputId}
					value={text}
					invalid={invalid}
					inputMode="decimal"
					className="min-w-0 flex-1"
					aria-describedby={invalid ? errorId : undefined}
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
			{invalid ? <FieldMessage id={errorId}>Enter a number.</FieldMessage> : null}
		</li>
	);
}

export function MeasurementComposer(props: {
	readonly label: string;
	readonly pending: boolean;
	readonly retained?: boolean;
	readonly onRetry?: () => void;
	readonly submitLabel: string;
	readonly pendingLabel: string;
	readonly initial: MeasurementDraft;
	readonly onCancel: () => void;
	readonly onChange: () => void;
	readonly errorMessage: string | undefined;
	readonly metrics: readonly ComposerMetric[];
	readonly occurredAtRef?: RefObject<HTMLInputElement | null>;
	readonly onSubmit: (readings: MeasurementEntry) => void;
}) {
	const {
		label,
		initial,
		metrics,
		pending,
		onCancel,
		onChange,
		onSubmit,
		submitLabel,
		errorMessage,
		pendingLabel,
		occurredAtRef,
	} = props;
	const occurredAtId = useId();
	const commentId = useId();
	const initialOccurredAt = toDateTimeInput(initial.occurredAt);
	const [occurredAt, setOccurredAt] = useState(initialOccurredAt);
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
	const timestamp = Date.parse(occurredAt);
	let message: string | undefined;
	if (submitted && Number.isNaN(timestamp)) {
		message = "Enter a date and time.";
	} else if (submitted && values.length === 0 && parsed.every(({ value }) => value !== undefined)) {
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
			Number.isNaN(timestamp) ||
			values.length === 0 ||
			parsed.some(({ value }) => value === undefined)
		) {
			return;
		}
		onSubmit({
			values,
			comment: comment.trim(),
			occurredAt:
				occurredAt === initialOccurredAt ? initial.occurredAt : new Date(timestamp).toISOString(),
		});
	};
	let actionLabel = submitLabel;
	if (pending) {
		actionLabel = pendingLabel;
	} else if (props.retained) {
		actionLabel = "Retry save";
	}
	return (
		<ActionForm label={label} onSubmit={save} className="flex flex-col gap-4">
			<fieldset className="flex flex-col gap-4" disabled={pending || props.retained}>
				<div className="flex flex-col gap-1.5">
					<label htmlFor={occurredAtId} className="text-sm font-medium text-text">
						Date and time
					</label>
					<TextField
						id={occurredAtId}
						value={occurredAt}
						ref={occurredAtRef}
						type="datetime-local"
						invalid={submitted && Number.isNaN(timestamp)}
						onChange={(event) => change(() => setOccurredAt(event.target.value))}
					/>
				</div>
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
				<div className="flex flex-col gap-1.5">
					<label htmlFor={commentId} className="text-sm font-medium text-text">
						Comment (optional)
					</label>
					<TextArea
						rows={2}
						id={commentId}
						value={comment}
						onChange={(event) => change(() => setComment(event.target.value))}
					/>
				</div>
			</fieldset>
			{message === undefined ? null : <FieldMessage>{message}</FieldMessage>}
			{errorMessage === undefined ? null : (
				<StatusMessage tone="error">{errorMessage}</StatusMessage>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" disabled={pending} onClick={onCancel} variant="secondary">
					Cancel
				</Button>
				<Button type="button" onClick={save} disabled={pending}>
					{actionLabel}
				</Button>
			</div>
		</ActionForm>
	);
}

export function MeasurementDialog(
	props: Omit<Parameters<typeof MeasurementComposer>[0], "occurredAtRef" | "onCancel"> & {
		readonly onClose: () => void;
		readonly triggerRef: RefObject<HTMLButtonElement | null>;
	},
) {
	const { onClose, triggerRef, ...composer } = props;
	const occurredAtRef = useRef<HTMLInputElement>(null);
	return (
		<Modal
			onClose={onClose}
			label={props.label}
			triggerRef={triggerRef}
			dismissible={!props.pending}
			initialFocusRef={occurredAtRef}
			closeLabel={`Close ${props.label.toLowerCase()}`}
			containerClassName="items-center justify-center p-4"
			className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-border bg-raised p-5 font-ui"
		>
			<h2 className="mb-4 font-display text-xl font-semibold text-text">{props.label}</h2>
			<MeasurementComposer {...composer} onCancel={onClose} occurredAtRef={occurredAtRef} />
		</Modal>
	);
}
