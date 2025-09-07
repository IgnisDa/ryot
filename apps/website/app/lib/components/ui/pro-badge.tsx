import { cn } from "@ryot/ts-utils";
import { Crown } from "lucide-react";
import { Badge } from "./badge";

export function ProBadge(props: { className?: string }) {
	return (
		<Badge
			className={cn(
				"bg-gradient-to-r from-orange-500 to-pink-500 text-white border-0 text-xs",
				props.className,
			)}
		>
			<Crown className="w-3 h-3 mr-1" />
			PRO
		</Badge>
	);
}
