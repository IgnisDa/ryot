import Autoplay from "embla-carousel-autoplay";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
} from "~/lib/components/ui/carousel";
import { cn } from "~/lib/utils";

export default function Page() {
	return (
		<section
			id="comparison"
			className="w-full py-12 md:py-24 lg:py-32 bg-muted"
		>
			<div className="container space-y-4 px-4 md:px-6 text-center">
				<div className="space-y-2">
					<div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm bg-white">
						Comparison
					</div>
				</div>
				<Carousel plugins={[Autoplay({ delay: 5000 })]}>
					<CarouselContent>
						{features.map((feature) => (
							<CarouselItem
								key={feature.name}
								className="flex flex-col space-y-4"
							>
								<h1 className="lg:leading-tighter text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl xl:text-[3.4rem] 2xl:text-[3.75rem]">
									{feature.name}
								</h1>
								<p className="mx-auto max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
									{feature.points.join(" ")}
								</p>
								<div className="my-auto flex items-center justify-center">
									<img
										src={feature.image}
										alt={feature.name}
										className={cn(
											"rounded-xl max-h-96 md:max-w-3xl lg:max-w-4xl xl:max-w-6xl",
											!feature.noBorder && "border rounded-lg shadow-lg",
										)}
									/>
								</div>
							</CarouselItem>
						))}
					</CarouselContent>
					<div className="hidden md:block">
						<CarouselPrevious />
						<CarouselNext />
					</div>
				</Carousel>
			</div>
		</section>
	);
}

const features = [
	{
		name: "Sharing",
		image: "/sharing-form.png",
		points: [
			"Share your profile with your friends and family.",
			"Set an expiry (or don't!) and revoke access at any time.",
			"Anonymous users can only view your data, not change it.",
		],
	},
	{
		name: "Recommendations",
		image: "/recommendations.png",
		points: [
			'A new section called "Recommendations" is added to the Dashboard where you can view personalized suggestions based on your recent media consumption. They are refreshed every hour.',
		],
	},
	{
		name: "Supercharged Collections",
		image: "/supercharged-collections.png",
		noBorder: true,
		points: [
			'Create information templates for your collections. These templates will be used when you add media to your collection. You can see an example of this on the community edition with the "Owned" and "Reminders" collection.',
			"Add collaborators to your collections. This feature is useful when you want to share your collection with your friends or family. They can also add or remove media from it.",
		],
	},
	{
		name: "Other Enhancements",
		image: "/other-enhancements.png",
		points: [
			"Create templates to schedule future workouts.",
			'Option to automatically sync media items from integrations to the "Owned" collection.',
			'Easier navigation for the "History" tab in media details to your favorite episode.',
			"Easily view history for an exercise and copy it to your current workout.",
			"Add notes to individual sets in a workout.",
			"Set time spent manually on seen entries, allowing for more accurate tracking of media consumption.",
		],
	},
];
