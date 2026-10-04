import type { ComponentProps, ReactNode } from "react";

import { Button } from "./button";

type LoadMoreButtonProps = Omit<ComponentProps<typeof Button>, "children" | "loading"> & {
	readonly label: string;
	readonly isFetchingNextPage: boolean;
	readonly loadingLabel?: string;
	readonly icon?: ReactNode;
};

export function LoadMoreButton({
	icon,
	label,
	type = "button",
	isFetchingNextPage,
	variant = "secondary",
	loadingLabel = "Loading...",
	...props
}: LoadMoreButtonProps) {
	return (
		<Button {...props} type={type} variant={variant} loading={isFetchingNextPage}>
			{icon}
			{isFetchingNextPage ? loadingLabel : label}
		</Button>
	);
}
