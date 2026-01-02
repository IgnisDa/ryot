import { cn } from "@ryot/ts-utils";
import { OTPInput, OTPInputContext } from "input-otp";
import { Dot } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	type ComponentRef,
	forwardRef,
	useContext,
} from "react";

const InputOTP = forwardRef<
	ComponentRef<typeof OTPInput>,
	ComponentPropsWithoutRef<typeof OTPInput>
>((props, ref) => {
	const { className, containerClassName, ...rest } = props;
	return (
		<OTPInput
			ref={ref}
			containerClassName={cn(
				"flex items-center gap-2 has-disabled:opacity-50",
				containerClassName,
			)}
			className={cn("disabled:cursor-not-allowed", className)}
			{...rest}
		/>
	);
});
InputOTP.displayName = "InputOTP";

const InputOTPGroup = forwardRef<
	ComponentRef<"div">,
	ComponentPropsWithoutRef<"div">
>((props, ref) => {
	const { className, ...rest } = props;
	return (
		<div ref={ref} className={cn("flex items-center", className)} {...rest} />
	);
});
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = forwardRef<
	ComponentRef<"div">,
	ComponentPropsWithoutRef<"div"> & { index: number }
>((props, ref) => {
	const { index, className, ...rest } = props;
	const inputOTPContext = useContext(OTPInputContext);
	const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index];

	return (
		<div
			ref={ref}
			className={cn(
				"relative flex h-10 w-10 items-center justify-center border-y border-r border-input text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
				isActive && "z-10 ring-2 ring-ring ring-offset-background",
				className,
			)}
			{...rest}
		>
			{char}
			{hasFakeCaret && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
				</div>
			)}
		</div>
	);
});
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = forwardRef<
	ComponentRef<"div">,
	ComponentPropsWithoutRef<"div">
>((props, ref) => (
	<div ref={ref} {...props} aria-hidden>
		<Dot />
	</div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
