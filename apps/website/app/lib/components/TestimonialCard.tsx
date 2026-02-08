import { Card, CardContent } from "~/lib/components/ui/card";
import { StarRating } from "./StarRating";

export interface Testimonial {
	quote: string;
	name: string;
	title: string;
	rating: number;
	initials: string;
}

type TestimonialCardProps = {
	testimonial: Testimonial;
};

export function TestimonialCard(props: TestimonialCardProps) {
	return (
		<Card className="bg-card/50 backdrop-blur-sm">
			<CardContent className="pt-6">
				<div className="mb-4">
					<StarRating filled={props.testimonial.rating} />
				</div>
				<p className="text-foreground mb-4">{props.testimonial.quote}</p>
				<div className="flex items-center">
					<div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center mr-3">
						<span className="text-primary font-semibold">
							{props.testimonial.initials}
						</span>
					</div>
					<div>
						<p className="font-medium">{props.testimonial.name}</p>
						<p className="text-sm text-muted-foreground">
							{props.testimonial.title}
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
