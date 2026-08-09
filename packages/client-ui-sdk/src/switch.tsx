import clsx from "clsx";

type SwitchProps = {
	readonly label: string;
	readonly checked: boolean;
	readonly disabled?: boolean;
	readonly className?: string;
	readonly onChange: (value: boolean) => void;
};

export function Switch({ label, checked, disabled, className, onChange }: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			disabled={disabled}
			aria-label={label}
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={clsx(
				"flex h-6 w-10 items-center rounded-pill border border-border p-0.5",
				checked ? "bg-accent-deep" : "bg-surface-2",
				disabled === true && "opacity-50",
				className,
			)}
		>
			<span className={clsx("h-5 w-5 rounded-pill bg-raised", checked && "ml-auto")} />
		</button>
	);
}
