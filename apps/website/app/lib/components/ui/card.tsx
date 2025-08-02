import { cn } from "@ryot/ts-utils";
import * as React from "react";

const Card = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>((props, ref) => (
	<div
		ref={ref}
		className={cn(
			"rounded-lg border bg-card text-card-foreground shadow-xs",
			props.className,
		)}
		{...props}
	/>
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>((props, ref) => (
	<div
		ref={ref}
		className={cn("flex flex-col space-y-1.5 p-6", props.className)}
		{...props}
	/>
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
	HTMLParagraphElement,
	React.HTMLAttributes<HTMLHeadingElement>
>((props, ref) => (
	<h3
		ref={ref}
		className={cn(
			"text-2xl font-semibold leading-none tracking-tight",
			props.className,
		)}
		{...props}
	/>
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
	HTMLParagraphElement,
	React.HTMLAttributes<HTMLParagraphElement>
>((props, ref) => (
	<p
		ref={ref}
		className={cn("text-sm text-muted-foreground", props.className)}
		{...props}
	/>
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>((props, ref) => (
	<div ref={ref} className={cn("p-6 pt-0", props.className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>((props, ref) => (
	<div
		ref={ref}
		className={cn("flex items-center p-6 pt-0", props.className)}
		{...props}
	/>
));
CardFooter.displayName = "CardFooter";

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardDescription,
	CardContent,
};
