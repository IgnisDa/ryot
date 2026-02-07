import { Star } from "lucide-react";

type StarRatingProps = {
	filled: number;
	total?: number;
};

export function StarRating(props: StarRatingProps) {
	const total = props.total ?? 5;
	const filled = Math.min(props.filled, total);

	return (
		<div className="flex items-center">
			{[...Array(total).keys()].map((position) => (
				<Star
					key={position}
					className={
						position < filled
							? "w-4 h-4 fill-yellow-400 text-yellow-400"
							: "w-4 h-4 text-gray-300"
					}
				/>
			))}
		</div>
	);
}
