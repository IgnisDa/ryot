import { FieldMessage, TextField } from "./text-field";

export type DurationDraft = { readonly hours: string; readonly minutes: string };

const WHOLE_NUMBER = /^\d+$/;
const DECIMAL_NUMBER = /^\d+(?:\.\d+)?$/;

export const durationDraft = (minutes: number | undefined): DurationDraft =>
	minutes === undefined
		? { hours: "", minutes: "" }
		: { minutes: String(minutes % 60), hours: String(Math.floor(minutes / 60)) };

/** Minutes for whole hours and nonnegative minutes; `undefined` when empty, `null` when invalid. */
export const parseDuration = (draft: DurationDraft) => {
	const hours = draft.hours.trim();
	const minutes = draft.minutes.trim();
	if (
		(hours !== "" && !WHOLE_NUMBER.test(hours)) ||
		(minutes !== "" && !DECIMAL_NUMBER.test(minutes))
	) {
		return null;
	}
	if (hours === "" && minutes === "") {
		return undefined;
	}
	const total = Number(hours === "" ? 0 : hours) * 60 + Number(minutes === "" ? 0 : minutes);
	return Number.isFinite(total) ? total : null;
};

export function DurationField(props: {
	readonly hint: string;
	readonly label: string;
	readonly value: DurationDraft;
	readonly error: string | undefined;
	readonly onChange: (value: DurationDraft) => void;
}) {
	const invalid = props.error !== undefined;
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-label font-medium text-text">{props.label}</span>
			<div className="flex items-center gap-2">
				<TextField
					type="text"
					placeholder="0"
					className="w-20"
					invalid={invalid}
					aria-label="Hours"
					inputMode="numeric"
					value={props.value.hours}
					onChange={(event) =>
						props.onChange({ minutes: props.value.minutes, hours: event.currentTarget.value })
					}
				/>
				<span className="text-text-muted">h</span>
				<TextField
					type="text"
					placeholder="0"
					className="w-20"
					invalid={invalid}
					inputMode="decimal"
					aria-label="Minutes"
					value={props.value.minutes}
					onChange={(event) =>
						props.onChange({ hours: props.value.hours, minutes: event.currentTarget.value })
					}
				/>
				<span className="text-text-muted">min</span>
			</div>
			{invalid ? (
				<FieldMessage>{props.error}</FieldMessage>
			) : (
				<p className="text-xs text-text-muted">{props.hint}</p>
			)}
		</div>
	);
}
