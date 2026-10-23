import clsx from "clsx";

import { Chip } from "./chips";
import { RadioGroup, type RadioGroupOption } from "./radio-group";

type ChipRadioGroupProps<O extends RadioGroupOption> = {
	readonly label: string;
	readonly className?: string;
	readonly options: readonly O[];
	readonly value: O["value"] | undefined;
	readonly overflow: "scroll" | "wrap";
	readonly onChange: (value: O["value"]) => void;
};

export function ChipRadioGroup<O extends RadioGroupOption>({
	overflow,
	className,
	...props
}: ChipRadioGroupProps<O>) {
	const scroll = overflow === "scroll";
	const group = (
		<RadioGroup
			{...props}
			className={scroll ? "flex w-max gap-2" : clsx("flex flex-wrap gap-2", className)}
			renderOption={(option, selected) => ({
				className: "rounded-pill",
				content: <Chip checked={selected} label={option.label} />,
			})}
		/>
	);
	return scroll ? <div className={clsx("overflow-x-auto", className)}>{group}</div> : group;
}
