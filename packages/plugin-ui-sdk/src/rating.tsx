import {
	fromScale,
	type RatingScale,
	ratingScales,
	threePointRatings,
	toScale,
} from "@ryot-app/contract/modules/events/rating-scale";
import { roundHalfUp } from "@ryot-app/contract/schema/numeric-normalization";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import clsx from "clsx";
import { type ReactNode, type RefObject, useId, useState } from "react";

import { Button } from "./button";
import { Chip } from "./chips";
import { type MetricFormat, ratingUnit, useMetricFormat } from "./metric-format";
import { RadioGroup } from "./radio-group";
import { StatusMessage } from "./status-message";
import { TextField } from "./text-field";

const threePointFaces = ["🙁", "😐", "🙂"] as const;

const stepDecimals = (step: number) => String(step).split(".")[1]?.length ?? 0;

const isStepMultiple = (value: number, step: number) =>
	Math.abs(value / step - Math.round(value / step)) < 1e-9;

const ratingLabel = (
	t: (message: Message) => Text,
	format: MetricFormat,
	rating: number,
	scale: RatingScale,
) =>
	scale === "three-point"
		? format.formatRating(rating, scale)
		: t(
				kernelMessage("ui.rating.value-label", {
					scale,
					max: ratingScales[scale].max,
					value: format.formatRating(rating, scale),
				}),
			);

const ratingDraft = (rating: null | number | undefined, scale: RatingScale) => {
	if (rating === null || rating === undefined) {
		return "";
	}
	const { step } = ratingScales[scale];
	return String(roundHalfUp(Math.round(toScale(rating, scale) / step) * step, stepDecimals(step)));
};

const readRatingDraft = (
	draft: string,
	scale: RatingScale,
): { readonly valid: false } | { readonly valid: true; readonly rating: null | number } => {
	const text = draft.trim();
	if (text === "") {
		return { valid: true, rating: null };
	}
	const value = Number(text);
	const { max, step } = ratingScales[scale];
	return Number.isFinite(value) && value >= 0 && value <= max && isStepMultiple(value, step)
		? { valid: true, rating: fromScale(value, scale) }
		: { valid: false };
};

/** A scaled rating draft; an untouched draft keeps the exact stored rating it started from. */
export function useRatingDraft(initial: null | number | undefined, scale: RatingScale) {
	const [start] = useState(() => ratingDraft(initial, scale));
	const [draft, setDraft] = useState(start);
	const result =
		draft === start
			? { valid: true as const, rating: initial ?? null }
			: readRatingDraft(draft, scale);
	return { draft, result, setDraft };
}

const numberError = (scale: RatingScale) => {
	const { max, step } = ratingScales[scale];
	return step === 1
		? kernelMessage("ui.rating.whole-number-required", { max })
		: kernelMessage("ui.rating.decimal-number-required", { max });
};

const starOptions = (t: (message: Message) => Text, disabled: boolean) =>
	Array.from({ length: 10 }, (_, index) => {
		const value = (index + 1) / 2;
		return {
			disabled,
			value: String(value),
			label: t(kernelMessage("ui.rating.stars", { count: value })),
		};
	});

const threePointOptions = (t: (message: Message) => Text, disabled: boolean) =>
	threePointRatings.map((rating, index) => ({
		disabled,
		value: String(index),
		label: t(kernelMessage("ui.rating.three-point", { rating })),
	}));

export function RatingInput(props: {
	readonly value: string;
	readonly scale: RatingScale;
	readonly disabled?: boolean | undefined;
	readonly onChange: (draft: string) => void;
	readonly inputRef?: undefined | RefObject<null | HTMLInputElement>;
}) {
	const t = useT();
	const id = useId();
	const { scale, value, inputRef, onChange } = props;
	const label = t(
		kernelMessage("ui.rating.input-label", {
			scale: scale === "three-point" ? "three_point" : scale,
		}),
	);
	const definition = ratingScales[scale];
	if (definition.input === "number") {
		const valid = readRatingDraft(value, scale).valid;
		return (
			<div className="flex flex-col gap-2">
				<label htmlFor={id}>{label}</label>
				<TextField
					id={id}
					type="text"
					value={value}
					ref={inputRef}
					invalid={!valid}
					inputMode="decimal"
					disabled={props.disabled}
					aria-describedby={valid ? undefined : `${id}-error`}
					onChange={(event) => onChange(event.currentTarget.value)}
				/>
				{valid ? null : (
					<StatusMessage tone="error" id={`${id}-error`}>
						{t(numberError(scale))}
					</StatusMessage>
				)}
			</div>
		);
	}
	const selected = value === "" ? undefined : value;
	const disabled = props.disabled === true;
	const options = (definition.input === "stars" ? starOptions : threePointOptions)(t, disabled);
	return (
		<div className="flex flex-col gap-2">
			<span aria-hidden="true">{label}</span>
			<div className="flex flex-wrap items-center gap-3">
				{definition.input === "stars" ? (
					<RadioGroup
						label={label}
						value={selected}
						options={options}
						onChange={onChange}
						className="flex items-center"
						renderOption={(option) => ({
							className:
								"h-9 w-4 overflow-hidden rounded-sm pointer-coarse:h-11 pointer-coarse:w-5",
							content: (
								<span
									aria-hidden="true"
									className={clsx(
										"block w-8 text-center text-[1.75rem] leading-9 pointer-coarse:w-10 pointer-coarse:leading-11",
										option.value.endsWith(".5") ? "" : "-translate-x-1/2",
										selected !== undefined && Number(option.value) <= Number(selected)
											? "text-accent"
											: "text-text-subtle",
									)}
								>
									★
								</span>
							),
						})}
					/>
				) : (
					<RadioGroup
						label={label}
						value={selected}
						options={options}
						onChange={onChange}
						className="flex flex-wrap gap-2"
						renderOption={(option, checked) => ({
							className: "rounded-pill",
							content: (
								<Chip
									checked={checked}
									label={t(
										kernelMessage("ui.rating.three-point-option", {
											label: option.label,
											face: threePointFaces[Number(option.value)] ?? "",
										}),
									)}
								/>
							),
						})}
					/>
				)}
				{selected === undefined ? null : (
					<Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange("")}>
						{t(kernelMessage("ui.rating.clear"))}
					</Button>
				)}
			</div>
		</div>
	);
}

const starFills = ["empty", "half", "full"] as const;

function Stars(props: { readonly stars: number }) {
	return Array.from({ length: 5 }, (_, index) => {
		const fill = starFills[Math.min(Math.max(props.stars - index, 0), 1) * 2] ?? "empty";
		return (
			<span key={index} data-fill={fill} className="relative inline-block text-text-subtle">
				★
				{fill === "empty" ? null : (
					<span
						className={clsx(
							"absolute inset-y-0 left-0 overflow-hidden text-accent",
							fill === "full" ? "w-full" : "w-1/2",
						)}
					>
						★
					</span>
				)}
			</span>
		);
	});
}

const ratingVisual = (format: MetricFormat, rating: number, scale: RatingScale): ReactNode => {
	if (scale === "five") {
		return <Stars stars={Number(ratingDraft(rating, scale))} />;
	}
	if (scale === "three-point") {
		return `${threePointFaces[toScale(rating, scale)] ?? ""} ${format.formatRating(rating, scale)}`;
	}
	return format.formatMetric(rating, ratingUnit(scale));
};

export function RatingValue(props: {
	readonly rating: number;
	readonly scale: RatingScale;
	readonly className?: string | undefined;
}) {
	const t = useT();
	const format = useMetricFormat();
	return (
		<span
			role="img"
			aria-label={ratingLabel(t, format, props.rating, props.scale)}
			className={clsx("inline-flex items-baseline tabular-nums", props.className)}
		>
			{ratingVisual(format, props.rating, props.scale)}
		</span>
	);
}
