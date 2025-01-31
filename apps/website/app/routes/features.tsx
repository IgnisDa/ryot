import { cn, snakeCase } from "@ryot/ts-utils";
import Autoplay from "embla-carousel-autoplay";
import {
	LucideAmpersands,
	LucideBadgeInfo,
	LucideBellDot,
	LucideBookHeart,
	LucideCalendarRange,
	LucideCandy,
	LucideChartColumnBig,
	LucideChartLine,
	LucideCog,
	LucideDatabaseZap,
	LucideDumbbell,
	LucideImageUp,
	LucideImport,
	LucideLayoutTemplate,
	LucideLibraryBig,
	LucideMegaphone,
	LucideMessageSquareText,
	LucideNotebookPen,
	LucideNotebookTabs,
	LucidePackageOpen,
	LucideProjector,
	LucideRefreshCcwDot,
	LucideRouter,
	LucideRuler,
	LucideScale3D,
	LucideShare,
	LucideSquareStack,
	LucideTimer,
	LucideToggleLeft,
	LucideVibrate,
	LucideWatch,
} from "lucide-react";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
} from "~/lib/components/ui/carousel";
import { logoUrl } from "~/lib/utils";

export const meta = () => {
	return [{ title: "Features | Ryot" }];
};

export default function Page() {
	return (
		<div>
			<div className="bg-muted py-20 md:py-32">
				<img
					alt="Ryot"
					src={logoUrl}
					className="size-28 sm:size-40 mx-auto mb-10"
				/>
				<div className="space-y-4">
					<h1 className="text-center text-2xl sm:text-3xl">
						Think of Ryot as your second brain with superpowers ✨
					</h1>
					<h2 className="text-center sm:text-xl text-gray-500">
						What all can Ryot do for you?
					</h2>
				</div>
			</div>
			{dataToDisplay.map((data, index) => (
				<div
					key={data.heading}
					id={snakeCase(data.heading)}
					className={cn(
						"py-10 space-y-4 md:space-y-8",
						index % 2 === 1 ? "bg-muted" : "bg-white",
					)}
				>
					<h2 className="text-center text-2xl sm:text-3xl font-semibold lowercase underline underline-offset-4">
						{data.heading}
					</h2>
					{data.images.length > 0 ? (
						<Carousel
							plugins={[Autoplay({ delay: 5000 })]}
							className="w-screen"
						>
							<CarouselContent>
								{data.images.map((image, index) => (
									<CarouselItem key={image} className="flex flex-col space-y-4">
										<img
											src={`/features/${image}`}
											alt={`${data.heading}-${index + 1}`}
											className="mx-auto rounded-xl md:max-h-96 md:max-w-3xl lg:max-w-4xl xl:max-w-6xl object-contain"
										/>
									</CarouselItem>
								))}
							</CarouselContent>
						</Carousel>
					) : null}
					<div className="px-2 md:px-0 mx-auto grid items-start gap-5 md:gap-8 sm:max-w-4xl sm:grid-cols-2 lg:max-w-5xl lg:grid-cols-3">
						{data.features.map((f) => (
							<div
								className="flex items-center justify-center gap-x-3 h-full"
								key={f.text}
							>
								<div
									className={cn(
										"p-2 border rounded-md",
										f.isPro
											? "border-black bg-green-200/20"
											: "border-transparent",
									)}
								>
									<f.icon className="size-6 flex-none mx-auto" />
									{f.isPro ? (
										<div className="text-green-700 text-[10px] mt-2 text-center font-semibold">
											PRO
										</div>
									) : null}
								</div>
								<p className="text-muted-foreground">{f.text}</p>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

const dataToDisplay = [
	{
		heading: "Media Tracking",
		images: ["desktop.png", "genres.png", "group.png"],
		features: [
			{
				icon: LucideNotebookTabs,
				text: "Track everything you want: movies, shows, books, podcasts, games, anime, manga, music, visual novels",
			},
			{
				icon: LucideLibraryBig,
				text: "Add media to your watchlist, favorite or any other custom collection",
			},
			{
				icon: LucideBookHeart,
				text: "Get recommendations based on your favorites and watch history",
				isPro: true,
			},
			{
				icon: LucideNotebookPen,
				text: "Track media you've watched and mark them as seen as many times as you want",
			},
			{
				icon: LucideImport,
				text: "Import your data from 13 different sources (with more to come)",
			},
			{
				icon: LucideRefreshCcwDot,
				text: "Integrations with 10 different services (with more on the way)",
			},
			{
				icon: LucideChartColumnBig,
				text: "Consolidated activity and statistics graphs and views across all your media",
			},
			{
				icon: LucideWatch,
				text: "Set time spent manually on seen entries for more accurate tracking of media consumption",
				isPro: true,
			},
			{
				icon: LucideMegaphone,
				text: "Get notifications when a new episode is released or your favorite actor is back on screen",
			},
			{
				icon: LucideVibrate,
				text: "Support for 9 different notification platforms (more being released soon)",
			},
			{
				icon: LucideBellDot,
				text: "Set reminders for when you want to watch something and get notified",
			},
			{
				icon: LucideMessageSquareText,
				text: "Review media privately or publicly and see what others think",
			},
			{
				icon: LucideProjector,
				text: "Get information on where you can watch a movie/show legally in your country",
			},
			{
				icon: LucidePackageOpen,
				text: "Browse media by genre or groups (eg: Star Wars collection)",
			},
			{
				icon: LucideCalendarRange,
				text: "Calendar view to get an overview on when a media is coming out",
			},
			{
				icon: LucideCandy,
				text: "Suggestions that cater to your tastes based on your watch history",
			},
			{
				icon: LucideRouter,
				text: "Integrations with Youtube Music and Jellyfin for your music collection",
				isPro: true,
			},
		],
	},
	{
		heading: "Fitness Tracking",
		images: [
			"current-workout.png",
			"measurements-graph.png",
			"logged-workout.png",
			"exercise-dataset.png",
		],
		features: [
			{
				icon: LucideDumbbell,
				text: "Hit the gym and track workouts in realtime",
			},
			{
				icon: LucideDatabaseZap,
				text: "Dataset of over 800 exercises with instructions (and the ability to add your own)",
			},
			{
				icon: LucideTimer,
				text: "Add rest timers to each set you complete",
			},
			{
				icon: LucideImageUp,
				text: "Create supersets and upload images for each exercise to track progression",
			},
			{
				icon: LucideSquareStack,
				text: "Inline history and images of exercises while logging an active workout",
			},
			{
				icon: LucideLayoutTemplate,
				text: "Create templates to pre plan workouts beforehand",
				isPro: true,
			},
			{
				icon: LucideChartLine,
				text: "Graphs of progress for exercises to visualize your progress over time",
			},
			{
				icon: LucideRuler,
				text: "Keep track of your measurements like body weight, sugar level etc.",
			},
			{
				icon: LucideScale3D,
				text: "Visualizations of how your measurements fluctuate over time. Use them to identify trends and patterns.",
			},
		],
	},
	{
		heading: "Other Goodies",
		images: [
			"sharing.png",
			"recommendations.png",
			"sharing-form.png",
			"supercharged-collections.png",
		],
		features: [
			{
				icon: LucideShare,
				text: "Share access links to your data with your friends and family",
				isPro: true,
			},
			{
				icon: LucideCog,
				text: "Fine grained preferences to customize exactly what you want to track",
			},
			{
				icon: LucideAmpersands,
				text: "Add collaborators to your collections to allow them to add to them",
				isPro: true,
			},
			{
				icon: LucideToggleLeft,
				text: "Dark and light mode, because Ryot is at your fingertips the whole time",
			},
			{
				icon: LucideBadgeInfo,
				text: "Add custom information to your collections to make them more personalized",
				isPro: true,
			},
		],
	},
];
