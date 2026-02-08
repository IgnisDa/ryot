import { cn } from "@ryot/ts-utils";

type LoadingSpinnerProps = {
	size?: "sm" | "md" | "lg";
	message?: string;
};

const sizeMap = {
	sm: "h-4 w-4",
	md: "h-8 w-8",
	lg: "h-12 w-12",
};

export function LoadingSpinner(props: LoadingSpinnerProps) {
	const size = props.size ?? "md";

	return (
		<div className="text-center py-8">
			<div
				className={cn(
					"animate-spin rounded-full border-b-2 border-primary mx-auto",
					sizeMap[size],
					props.message ? "mb-2" : "mb-4",
				)}
			/>
			{props.message && (
				<p className="text-sm text-muted-foreground">{props.message}</p>
			)}
		</div>
	);
}
