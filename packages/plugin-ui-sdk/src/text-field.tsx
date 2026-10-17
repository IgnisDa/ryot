import clsx from "clsx";
import { useId, type ComponentProps, type ReactNode } from "react";

type FieldProps = {
	readonly invalid?: boolean | undefined;
	readonly density?: "compact" | "default" | undefined;
};

const focusRing =
	"focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/25 focus-visible:outline-none";

const fieldClassName = (
	{ invalid, density = "default" }: FieldProps,
	sizing: { readonly compact: string; readonly default: string },
	className: string | undefined,
) =>
	clsx(
		"rounded-md border bg-surface text-base text-text transition-[border-color,box-shadow] duration-100 placeholder:text-text-subtle hover:border-text-subtle disabled:border-border disabled:bg-surface-2 disabled:text-text-subtle motion-reduce:transition-none pointer-fine:text-sm",
		focusRing,
		invalid === true
			? "border-danger focus-visible:border-danger focus-visible:ring-danger/25"
			: "border-border-strong",
		sizing[density],
		className,
	);

export function TextField({
	invalid,
	density,
	className,
	...props
}: ComponentProps<"input"> & FieldProps) {
	return (
		<input
			{...props}
			aria-invalid={invalid}
			className={fieldClassName(
				{ invalid, density },
				{ compact: "h-8 px-2.5", default: "h-9 px-3 pointer-coarse:h-11" },
				className,
			)}
		/>
	);
}

export function TextArea({
	invalid,
	density,
	className,
	...props
}: ComponentProps<"textarea"> & FieldProps) {
	return (
		<textarea
			{...props}
			aria-invalid={invalid}
			className={fieldClassName(
				{ invalid, density },
				{ default: "min-h-20 px-3 py-2", compact: "min-h-16 px-2.5 py-1.5" },
				className,
			)}
		/>
	);
}

export function CellInput({
	invalid,
	className,
	...props
}: ComponentProps<"input"> & { readonly invalid?: boolean | undefined }) {
	return (
		<input
			{...props}
			aria-invalid={invalid}
			className={clsx(
				"h-9 w-full min-w-0 rounded-sm border px-1 text-center text-base font-medium text-text tabular-nums transition-[background-color,border-color,box-shadow] duration-100 placeholder:font-normal placeholder:text-text-subtle hover:border-border-emphasis focus-visible:bg-surface disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11 pointer-fine:text-[15px]",
				focusRing,
				invalid === true
					? "border-danger bg-danger-soft focus-visible:border-danger focus-visible:ring-danger/25"
					: "border-transparent bg-surface-2",
				className,
			)}
		/>
	);
}

export function FieldMessage({ className, ...props }: ComponentProps<"p">) {
	return (
		<p role="alert" className={clsx("text-xs font-medium text-danger", className)} {...props} />
	);
}

type FieldControl = {
	readonly id: string;
	readonly invalid: boolean;
	readonly "aria-describedby": string | undefined;
};

export function Field(props: {
	readonly label: ReactNode;
	readonly hint?: ReactNode;
	readonly error?: string | undefined;
	readonly optional?: boolean;
	readonly className?: string;
	readonly children: (control: FieldControl) => ReactNode;
}) {
	const id = useId();
	const hintId = props.hint === undefined ? undefined : `${id}-hint`;
	const errorId = props.error === undefined ? undefined : `${id}-error`;
	const describedBy = [errorId, hintId].filter((value) => value !== undefined).join(" ");
	return (
		<div className={clsx("grid min-w-0 content-start gap-1.5", props.className)}>
			<label htmlFor={id} className="text-[13px] leading-[18px] font-medium text-text">
				{props.label}
				{props.optional === true && (
					<span className="font-normal text-text-subtle"> (optional)</span>
				)}
			</label>
			{props.children({
				id,
				invalid: props.error !== undefined,
				"aria-describedby": describedBy === "" ? undefined : describedBy,
			})}
			{props.error !== undefined && <FieldMessage id={errorId}>{props.error}</FieldMessage>}
			{props.hint !== undefined && (
				<p id={hintId} className="text-xs text-text-muted">
					{props.hint}
				</p>
			)}
		</div>
	);
}

type ChoiceProps = Omit<ComponentProps<"input">, "type"> & { readonly label: ReactNode };

const choiceLabel =
	"inline-flex items-center gap-2.5 text-sm text-text has-disabled:opacity-50 pointer-coarse:min-h-11";

export function Checkbox({ label, className, ...props }: ChoiceProps) {
	return (
		<label className={clsx(choiceLabel, className)}>
			<span className="relative grid shrink-0 place-items-center">
				<input
					{...props}
					type="checkbox"
					className="peer size-4.5 appearance-none rounded-[5px] border-[1.5px] border-border-strong bg-surface transition-colors duration-100 checked:border-accent-deep checked:bg-accent-deep motion-reduce:transition-none"
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute mb-0.5 h-2.5 w-1.5 rotate-45 border-r-2 border-b-2 border-surface opacity-0 peer-checked:opacity-100"
				/>
			</span>
			{label}
		</label>
	);
}

export function Radio({ label, className, ...props }: ChoiceProps) {
	return (
		<label className={clsx(choiceLabel, className)}>
			<input
				{...props}
				type="radio"
				className="size-4.5 shrink-0 appearance-none rounded-full border-[1.5px] border-border-strong bg-surface transition-[border-width,border-color] duration-100 checked:border-[5px] checked:border-accent-deep motion-reduce:transition-none"
			/>
			{label}
		</label>
	);
}
