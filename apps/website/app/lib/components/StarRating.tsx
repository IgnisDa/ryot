import { Star } from "lucide-react";

type StarRatingProps = {
	filled: number;
	total?: number;
};

export function StarRating(props: StarRatingProps) {
	const total = props.total ?? 5;
	const filled = Math.min(props.filled, total);
	const empty = total - filled;

	return (
		<div className="flex items-center">
			{Array.from({ length: filled }, (_, i) => (
				<Star
					key={`filled-${i}`}
					className="w-4 h-4 fill-yellow-400 text-yellow-400"
				/>
			))}
			{Array.from({ length: empty }, (_, i) => (
				<Star key={`empty-${i}`} className="w-4 h-4 text-gray-300" />
			))}
		</div>
	);
}
