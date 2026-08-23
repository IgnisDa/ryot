/* oxlint-disable perfectionist/sort-objects -- Keep related control states together. */
import * as stylex from "@stylexjs/stylex";
import {
	useId,
	type ButtonHTMLAttributes,
	type InputHTMLAttributes,
	type ReactNode,
	type Ref,
} from "react";

import { tracerTokens } from "./tokens.stylex";

type ButtonOverrideProperties = Pick<stylex.CSSProperties, "backgroundColor" | "color">;

export type StyleXTracerButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"className" | "style"
> & {
	readonly children: ReactNode;
	readonly ref?: Ref<HTMLButtonElement>;
	readonly tone?: "primary" | "secondary";
	readonly xstyle?: stylex.StyleXStyles<ButtonOverrideProperties>;
};

export function StyleXTracerButton({
	xstyle,
	children,
	tone = "primary",
	...buttonProps
}: StyleXTracerButtonProps) {
	return (
		<button
			{...buttonProps}
			{...stylex.props(
				buttonStyles.base,
				buttonStyles.baseActive,
				buttonStyles.baseFocusVisible,
				buttonStyles.baseDisabled,
				buttonStyles.baseReducedMotion,
				buttonStyles[tone],
				buttonStyles[tone === "primary" ? "primaryHover" : "secondaryHover"],
				xstyle,
			)}
		>
			{children}
		</button>
	);
}

export type StyleXTracerTextFieldProps = Omit<
	InputHTMLAttributes<HTMLInputElement>,
	"className" | "style" | "type"
> & { readonly label: string; readonly error?: string };

export function StyleXTracerTextField({
	error,
	label,
	id: suppliedId,
	...inputProps
}: StyleXTracerTextFieldProps) {
	const generatedId = useId();
	const id = suppliedId ?? generatedId;
	const errorId = `${id}-error`;

	return (
		<label {...stylex.props(fieldStyles.field)} htmlFor={id}>
			<span {...stylex.props(fieldStyles.label)}>{label}</span>
			<input
				{...inputProps}
				id={id}
				type="text"
				aria-invalid={error === undefined ? undefined : true}
				aria-describedby={error === undefined ? inputProps["aria-describedby"] : errorId}
				{...stylex.props(
					fieldStyles.input,
					fieldStyles.inputPlaceholder,
					fieldStyles.inputFocusVisible,
					fieldStyles.inputDisabled,
					error !== undefined && fieldStyles.invalid,
				)}
			/>
			{error !== undefined && (
				<span id={errorId} role="alert" {...stylex.props(fieldStyles.error)}>
					{error}
				</span>
			)}
		</label>
	);
}

const buttonStyles = stylex.create({
	primary: {
		backgroundColor: tracerTokens.accent,
		borderColor: tracerTokens.accent,
		color: tracerTokens.accentInk,
	} satisfies stylex.CSSProperties,
	primaryHover: {
		":hover": { backgroundColor: tracerTokens.accentHover } satisfies stylex.CSSProperties,
	},
	secondary: {
		backgroundColor: tracerTokens.surfaceRaised,
		borderColor: tracerTokens.border,
		color: tracerTokens.foreground,
	} satisfies stylex.CSSProperties,
	secondaryHover: {
		":hover": { backgroundColor: tracerTokens.background } satisfies stylex.CSSProperties,
	},
	base: {
		appearance: "none",
		borderStyle: "solid",
		borderWidth: "1px",
		borderRadius: tracerTokens.radiusControl,
		cursor: "pointer",
		fontFamily: tracerTokens.fontBody,
		fontSize: "15px",
		fontWeight: 650,
		lineHeight: 1.2,
		minHeight: "44px",
		paddingBlock: tracerTokens.space3,
		paddingInline: tracerTokens.space4,
		transitionDuration: "140ms",
		transitionProperty: "background-color, border-color, color, transform",
		transitionTimingFunction: "ease-out",
	} satisfies stylex.CSSProperties,
	baseActive: { ":active": { transform: "translateY(1px)" } satisfies stylex.CSSProperties },
	baseFocusVisible: {
		":focus-visible": {
			outlineColor: tracerTokens.focus,
			outlineOffset: "3px",
			outlineStyle: "solid",
			outlineWidth: "2px",
		} satisfies stylex.CSSProperties,
	},
	baseDisabled: {
		":disabled": {
			cursor: "not-allowed",
			opacity: 0.5,
			transform: "none",
		} satisfies stylex.CSSProperties,
	},
	baseReducedMotion: {
		"@media (prefers-reduced-motion: reduce)": {
			transitionDuration: "0ms",
		} satisfies stylex.CSSProperties,
	},
});

const fieldStyles = stylex.create({
	invalid: { borderColor: tracerTokens.error } satisfies stylex.CSSProperties,
	error: {
		color: tracerTokens.error,
		fontSize: "14px",
		lineHeight: 1.35,
	} satisfies stylex.CSSProperties,
	label: {
		color: tracerTokens.foreground,
		fontSize: "15px",
		fontWeight: 650,
	} satisfies stylex.CSSProperties,
	field: {
		display: "flex",
		flexDirection: "column",
		gap: tracerTokens.space2,
	} satisfies stylex.CSSProperties,
	input: {
		appearance: "none",
		backgroundColor: tracerTokens.surfaceRaised,
		borderColor: tracerTokens.border,
		borderRadius: tracerTokens.radiusControl,
		borderStyle: "solid",
		borderWidth: "1px",
		color: tracerTokens.foreground,
		fontFamily: tracerTokens.fontBody,
		fontSize: "16px",
		lineHeight: 1.4,
		minHeight: "44px",
		paddingBlock: tracerTokens.space3,
		paddingInline: tracerTokens.space4,
	} satisfies stylex.CSSProperties,
	inputPlaceholder: {
		"::placeholder": {
			color: tracerTokens.foregroundMuted,
			opacity: 0.72,
		} satisfies stylex.CSSProperties,
	},
	inputFocusVisible: {
		":focus-visible": {
			borderColor: tracerTokens.focus,
			outlineColor: tracerTokens.focus,
			outlineOffset: "2px",
			outlineStyle: "solid",
			outlineWidth: "2px",
		} satisfies stylex.CSSProperties,
	},
	inputDisabled: {
		":disabled": { cursor: "not-allowed", opacity: 0.55 } satisfies stylex.CSSProperties,
	},
});
