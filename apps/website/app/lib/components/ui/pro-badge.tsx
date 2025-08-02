import { Crown } from "lucide-react";
import { Badge } from "./badge";

export function ProBadge({ className }: { className?: string }) {
	return (
		<Badge
			className={`bg-gradient-to-r from-orange-500 to-pink-500 text-white border-0 text-xs ${
				className || "ml-2"
			}`}
		>
			<Crown className="w-3 h-3 mr-1" />
			PRO
		</Badge>
	);
}
