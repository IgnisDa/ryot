import {
	formatRating,
	fromScale,
	type RatingScale,
	ratingScales,
	threePointRatings,
	toScale,
} from "@ryot-app/contract/modules/events/rating-scale";
import { roundHalfUp } from "@ryot-app/contract/schema/numeric-normalization";
import clsx from "clsx";
import { type ReactNode, type RefObject, useId, useState } from "react";

import { Button } from "./button";
import { Chip } from "./chips";
import { RadioGroup } from "./radio-group";
import { StatusMessage } from "./status-message";
import { TextField } from "./text-field";

const scaleCaptions = {
	five: "5 stars",
	ten: "out of 10",
	hundred: "out of 100",
	"three-point": "3-point",
} as const satisfies Record<RatingScale, string>;

const threePointFaces = ["🙁", "😐", "🙂"] as const;

const stepDecimals = (step: number) => String(step).split(".")[1]?.length ?? 0;

const isStepMultiple = (value: number, step: number) =>
	Math.abs(value / step - Math.round(value / step)) < 1e-9;

const ratingLabel = (rating: number, scale: RatingScale) => {
	if (scale === "three-point") {
		return formatRating(rating, scale);
	}
	const max = ratingScales[scale].max;
	return `${formatRating(rating, scale)} out of ${max}${scale === "five" ? " stars" : ""}`;
};

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
		? `Enter a whole number from 0 to ${max}.`
		: `Enter a number from 0 to ${max} with at most one decimal place.`;
};

const starOptions = (disabled: boolean) =>
	Array.from({ length: 10 }, (_, index) => {
		const value = (index + 1) / 2;
		return { disabled, value: String(value), label: `${value} ${value === 1 ? "star" : "stars"}` };
	});

const threePointOptions = (disabled: boolean) =>
	threePointRatings.map((label, index) => ({ label, disabled, value: String(index) }));

export function RatingInput(props: {
	readonly value: string;
	readonly scale: RatingScale;
	readonly disabled?: boolean | undefined;
	readonly onChange: (draft: string) => void;
	readonly inputRef?: undefined | RefObject<null | HTMLInputElement>;
}) {
	const id = useId();
	const { scale, value, inputRef, onChange } = props;
	const label = `Rating (${scaleCaptions[scale]}, optional)`;
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
						{numberError(scale)}
					</StatusMessage>
				)}
			</div>
		);
	}
	const selected = value === "" ? undefined : value;
	const disabled = props.disabled === true;
	const options = (definition.input === "stars" ? starOptions : threePointOptions)(disabled);
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
									label={`${threePointFaces[Number(option.value)] ?? ""} ${option.label}`}
								/>
							),
						})}
					/>
				)}
				{selected === undefined ? null : (
					<Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange("")}>
						Clear rating
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

const ratingVisual = (rating: number, scale: RatingScale): ReactNode => {
	if (scale === "five") {
		return <Stars stars={Number(ratingDraft(rating, scale))} />;
	}
	if (scale === "three-point") {
		return `${threePointFaces[toScale(rating, scale)] ?? ""} ${formatRating(rating, scale)}`;
	}
	return `${formatRating(rating, scale)} / ${ratingScales[scale].max}`;
};

export function RatingValue(props: {
	readonly rating: number;
	readonly scale: RatingScale;
	readonly className?: string | undefined;
}) {
	return (
		<span
			role="img"
			aria-label={ratingLabel(props.rating, props.scale)}
			className={clsx("inline-flex items-baseline tabular-nums", props.className)}
		>
			{ratingVisual(props.rating, props.scale)}
		</span>
	);
}
