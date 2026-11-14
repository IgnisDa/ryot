import clsx from "clsx";
import * as Effect from "effect/Effect";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button, iconButtonClassName } from "./button";
import { AppIcon } from "./icon";
import { FieldMessage } from "./text-field";

const COPIED_FEEDBACK_MS = 2000;

export type CopyFieldAction = {
	readonly kind: "copy" | "share";
	readonly perform: Effect.Effect<unknown, unknown>;
	readonly run: (work: Effect.Effect<void>, onExit: () => void) => () => void;
};

type Feedback = { readonly value: string; readonly status: "copied" | "failed" };

const buttonPresentation = (kind: CopyFieldAction["kind"], copied: boolean) => {
	if (kind === "share") {
		return { icon: "share", label: "Share" };
	}
	return copied ? { icon: "check", label: "Copied" } : { icon: "copy", label: "Copy" };
};

export function CopyField(props: {
	readonly value: string;
	readonly href?: string;
	readonly label: ReactNode;
	readonly hint?: ReactNode;
	readonly className?: string;
	readonly multiline?: boolean;
	readonly action: CopyFieldAction;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	const hintId = props.hint === undefined ? undefined : `${id}-hint`;
	const [feedback, setFeedback] = useState<null | Feedback>(null);
	const cancel = useRef<null | (() => void)>(null);
	useEffect(() => () => cancel.current?.(), []);
	const status = feedback?.value === props.value ? feedback.status : null;
	const presentation = buttonPresentation(props.action.kind, status === "copied");

	const copy = () => {
		cancel.current?.();
		const { value, action } = props;
		cancel.current = action.run(
			action.perform.pipe(
				Effect.tapError((error) => Effect.logWarning("copy failed", error)),
				Effect.matchEffect({
					onFailure: () =>
						Effect.sync(() =>
							setFeedback(action.kind === "copy" ? { value, status: "failed" } : null),
						),
					onSuccess: () =>
						action.kind === "share"
							? Effect.sync(() => setFeedback(null))
							: Effect.sync(() => setFeedback({ value, status: "copied" })).pipe(
									Effect.andThen(Effect.sleep(COPIED_FEEDBACK_MS)),
									Effect.andThen(Effect.sync(() => setFeedback(null))),
								),
				}),
			),
			() => undefined,
		);
	};

	const valueProps = {
		"data-copy-value": true,
		"aria-labelledby": labelId,
		"aria-describedby": hintId,
	};
	return (
		<div className={clsx("grid min-w-0 content-start gap-1.5", props.className)}>
			<span id={labelId} className="text-label font-medium text-text">
				{props.label}
			</span>
			<div className="flex min-w-0 items-start gap-0.5 rounded-md border border-border bg-surface-2 p-0.5 transition-[border-color,box-shadow] duration-100 motion-reduce:transition-none has-[[data-copy-value]:focus-visible]:border-focus has-[[data-copy-value]:focus-visible]:ring-3 has-[[data-copy-value]:focus-visible]:ring-focus/25">
				{props.multiline === true ? (
					<code
						{...valueProps}
						tabIndex={0}
						className="min-h-8 min-w-0 flex-1 px-2.5 py-1.5 font-mono text-sm leading-5 break-all text-text select-all focus-visible:outline-none pointer-coarse:min-h-10"
					>
						{props.value}
					</code>
				) : (
					<input
						{...valueProps}
						readOnly
						value={props.value}
						onFocus={(event) => event.currentTarget.select()}
						className="h-8 min-w-0 flex-1 truncate bg-transparent px-2.5 font-mono text-base text-text focus-visible:outline-none pointer-coarse:h-10 pointer-fine:text-sm"
					/>
				)}
				<Button size="sm" onClick={copy} variant="ghost" className="shrink-0">
					<AppIcon
						size={16}
						name={presentation.icon}
						className={clsx(status === "copied" && "text-success")}
					/>
					{presentation.label}
				</Button>
				{props.href !== undefined && (
					<a
						target="_blank"
						href={props.href}
						rel="noopener noreferrer"
						aria-label="Open in new tab"
						className={iconButtonClassName("sm", "ghost")}
					>
						<AppIcon size={16} name="external-link" />
					</a>
				)}
			</div>
			{status === "failed" && (
				<FieldMessage>Could not copy. Select the text and copy it manually.</FieldMessage>
			)}
			{hintId !== undefined && (
				<p id={hintId} className="text-xs text-text-muted">
					{props.hint}
				</p>
			)}
		</div>
	);
}
