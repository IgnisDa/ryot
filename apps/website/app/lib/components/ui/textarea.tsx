import { cn } from "@ryot/ts-utils";
import { forwardRef, type TextareaHTMLAttributes } from "react";

export interface TextareaProps
	extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
	(props, ref) => {
		const { className, ...rest } = props;
		return (
			<textarea
				className={cn(
					"flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				ref={ref}
				{...rest}
			/>
		);
	},
);
Textarea.displayName = "Textarea";

export { Textarea };
