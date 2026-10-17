import clsx from "clsx";

type SwitchProps = {
	readonly label: string;
	readonly checked: boolean;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly onChange: (value: boolean) => void;
};

export function Switch({ label, checked, disabled, onChange, className }: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-label={label}
			disabled={disabled}
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={clsx(
				"inline-flex h-5 w-8.5 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-6.5 pointer-coarse:w-11",
				checked ? "bg-accent-deep" : "bg-border-strong",
				className,
			)}
		>
			<span
				className={clsx(
					"size-4 rounded-pill bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none pointer-coarse:size-5.5",
					checked && "translate-x-3.5 pointer-coarse:translate-x-4.5",
				)}
			/>
		</button>
	);
}
