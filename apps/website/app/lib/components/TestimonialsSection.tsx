import { Users } from "lucide-react";
import { SectionHeader } from "~/lib/components/SectionHeader";
import {
	type Testimonial,
	TestimonialCard,
} from "~/lib/components/TestimonialCard";

const TESTIMONIALS: Testimonial[] = [
	{
		rating: 5,
		initials: "@B",
		name: "@beppi",
		title: "Fosstodon User",
		quote:
			"I love how easy it is to quickly add a game, book, movie or show after I'm finished and write a short review. It's probably the most used software on my home server!",
	},
	{
		rating: 4,
		initials: "MC",
		name: "Mike Chen",
		title: "Fitness Enthusiast",
		quote:
			"Finally, a platform that understands what I need for personal tracking. The analytics features are exactly what I was looking for.",
	},
	{
		rating: 4,
		initials: "AL",
		name: "Alex Liu",
		title: "Developer",
		quote:
			"The privacy features and self-hosting option sold me. Great for anyone who wants control over their personal data.",
	},
];

export const TestimonialsSection = () => (
	<section className="py-20">
		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<SectionHeader
				icon={Users}
				maxWidth="max-w-2xl"
				subtitle="Social Proof"
				title="Trusted by Thousands"
				description="Join the growing community of people who have transformed their personal tracking experience with Ryot."
			/>

			<div className="grid md:grid-cols-3 gap-8">
				{TESTIMONIALS.map((testimonial) => (
					<TestimonialCard key={testimonial.name} testimonial={testimonial} />
				))}
			</div>
		</div>
	</section>
);
