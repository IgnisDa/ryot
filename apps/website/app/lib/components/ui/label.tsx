import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@ryot/ts-utils";
import { type VariantProps, cva } from "class-variance-authority";
import {
	type ComponentPropsWithoutRef,
	type ComponentRef,
	forwardRef,
} from "react";

const labelVariants = cva(
	"text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
);

const Label = forwardRef<
	ComponentRef<typeof LabelPrimitive.Root>,
	ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
		VariantProps<typeof labelVariants>
>((props, ref) => {
	const { className, ...rest } = props;
	return (
		<LabelPrimitive.Root
			ref={ref}
			className={cn(labelVariants(), className)}
			{...rest}
		/>
	);
});
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
