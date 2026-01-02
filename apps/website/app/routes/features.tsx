import { cn } from "@ryot/ts-utils";
import Autoplay from "embla-carousel-autoplay";
import {
	AreaChart,
	ArrowRight,
	BarChart3,
	Bell,
	Brain,
	CheckCircle,
	Crown,
	Dumbbell,
	Film,
	FolderHeart,
	Heart,
	Lock,
	Play,
	Share2,
	Sparkles,
	Target,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { withFragment } from "ufo";
import { Badge } from "~/lib/components/ui/badge";
import { Button } from "~/lib/components/ui/button";
import { Card, CardContent } from "~/lib/components/ui/card";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
} from "~/lib/components/ui/carousel";
import { ProBadge } from "~/lib/components/ui/pro-badge";
import { serverVariables } from "~/lib/config.server";
import { initializePaddleForApplication } from "~/lib/general";
import type { Route } from "./+types/features";

export const meta = () => {
	return [{ title: "Features | Ryot" }];
};

export const loader = async (_args: Route.LoaderArgs) => {
	return {
		isSandbox: !!serverVariables.PADDLE_SANDBOX,
		clientToken: serverVariables.PADDLE_CLIENT_TOKEN,
	};
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	useEffect(() => {
		initializePaddleForApplication(
			loaderData.clientToken,
			loaderData.isSandbox,
		);
	}, []);

	return (
		<div className="min-h-screen">
			<section className="py-20 lg:py-32">
				<div className={SECTION_STYLES}>
					<div className="text-center mb-16">
						<Badge variant="secondary" className="mb-6">
							<Brain className="w-4 h-4 mr-2" />
							Comprehensive Tracking
						</Badge>
						<h1 className="text-4xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
							Think of Ryot as your{" "}
							<span className="text-primary">second brain</span> with
							superpowers ✨
						</h1>
						<p className="text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
							What all can Ryot do for you?
						</p>
					</div>
				</div>
			</section>

			<section className="py-20">
				<div className={SECTION_STYLES}>
					<div className="text-center mb-16">
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
							Everything You Need in One Place
						</h2>
						<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
							Discover all the powerful features that make Ryot your ultimate
							personal tracking companion.
						</p>
					</div>

					<div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
						{FEATURE_CARDS.map((card) => (
							<Card key={card.title} className={CARD_HOVER_STYLES}>
								<CardContent className="p-6">
									<div
										className={`w-12 h-12 ${colorMap[card.color].bg} rounded-lg flex items-center justify-center mb-4`}
									>
										<card.icon
											className={`w-6 h-6 ${colorMap[card.color].text}`}
										/>
									</div>
									<h3 className="text-xl font-semibold mb-3">{card.title}</h3>
									<p className="text-muted-foreground mb-4">
										{card.description}
									</p>
									<div
										className={`flex items-center text-sm ${colorMap[card.color].text}`}
									>
										<card.featureIcon className="w-4 h-4 mr-1" />
										{card.feature}
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			</section>

			{FEATURE_DATA.map((data, index) => (
				<FeatureSection
					key={data.heading}
					data={data}
					isEven={index % 2 === 0}
					showDescription={index === 1}
					customGrid={index === 2 ? "single" : "lg:grid-cols-2"}
				/>
			))}

			<section className="py-20 bg-linear-to-r from-orange-50 to-pink-50">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
					<div className="flex items-center justify-center gap-3 mb-6">
						<div className="w-12 h-12 bg-linear-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center">
							<Crown className="w-6 h-6 text-white" />
						</div>
						<span className="text-2xl font-bold text-foreground">
							Unlock Pro Features
						</span>
					</div>
					<p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
						Get access to advanced analytics, custom collections, sharing
						features, and much more with Ryot Pro. Upgrade your tracking
						experience today.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<Link to={withFragment($path("/"), "pricing")}>
							<Button size="lg">
								View Pricing Plans
								<ArrowRight className="w-4 h-4 ml-2" />
							</Button>
						</Link>
					</div>
				</div>
			</section>
		</div>
	);
}

const CARD_HOVER_STYLES =
	"hover:shadow-lg transition-all duration-300 hover:-translate-y-1";
const SECTION_STYLES = "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8";

const FeatureItem = (props: { children: ReactNode; isPro?: boolean }) => (
	<div className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
		<CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
		<div className="flex items-start flex-wrap gap-1">
			<span className="text-foreground leading-relaxed">{props.children}</span>
			{props.isPro && <ProBadge />}
		</div>
	</div>
);

const FeatureCarousel = (props: { images: string[]; altPrefix: string }) => (
	<div className="mb-16">
		<Carousel
			plugins={[Autoplay({ delay: 5000 })]}
			className="w-full max-w-5xl mx-auto"
		>
			<CarouselContent>
				{props.images.map((image, index) => (
					<CarouselItem key={image} className="flex flex-col space-y-4">
						<img
							src={`/features/${image}`}
							alt={`${props.altPrefix} ${index + 1}`}
							className="mx-auto rounded-2xl max-h-96 md:max-h-125 lg:max-h-150 w-full object-contain"
						/>
					</CarouselItem>
				))}
			</CarouselContent>
		</Carousel>
	</div>
);

const FeatureSection = (props: {
	isEven: boolean;
	customGrid?: string;
	showDescription?: boolean;
	data: (typeof FEATURE_DATA)[0];
}) => {
	const {
		data,
		isEven,
		showDescription,
		customGrid = "lg:grid-cols-2",
	} = props;
	return (
		<section className={cn("py-20", !isEven && "bg-muted/30")}>
			<div className={SECTION_STYLES}>
				<div className="text-center mb-16">
					<Badge variant="outline" className="mb-6">
						<data.icon className="w-4 h-4 mr-2" />
						{data.heading}
					</Badge>
					<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-8">
						{data.title}
					</h2>
					{showDescription && (
						<div className="mb-8">
							<h3 className="text-2xl font-semibold text-foreground mb-4">
								{data.description?.title}
							</h3>
							<p className="text-muted-foreground max-w-2xl mx-auto">
								{data.description?.text}
							</p>
						</div>
					)}
				</div>

				{data.images.length > 0 && (
					<FeatureCarousel
						images={data.images}
						altPrefix={`${data.heading} interface`}
					/>
				)}

				<div
					className={cn(
						customGrid === "single"
							? "max-w-4xl mx-auto"
							: cn("grid", customGrid, "gap-2"),
						!isEven && "mb-16",
					)}
				>
					{customGrid === "single" ? (
						<div className="space-y-2">
							{data.features.map((feature) => (
								<FeatureItem key={feature.text} isPro={feature.isPro}>
									{feature.text}
								</FeatureItem>
							))}
						</div>
					) : (
						data.features.map((feature) => (
							<FeatureItem key={feature.text} isPro={feature.isPro}>
								{feature.text}
							</FeatureItem>
						))
					)}
				</div>
			</div>
		</section>
	);
};

const FEATURE_DATA = [
	{
		heading: "Media Tracking",
		title: "Your Complete Media Universe",
		icon: Film,
		images: ["desktop.png", "genres.png", "group.png"],
		features: [
			{
				text: "Track everything you want: movies, shows, books, podcasts, games, anime, manga, music, visual novels",
			},
			{
				text: "Add media to your watchlist, favorite or any other custom collection",
				isPro: true,
			},
			{
				text: "Get recommendations based on your favorites and watch history",
				isPro: true,
			},
			{
				text: "Track media you've watched and mark them as seen as many times as you want",
			},
			{
				text: "Import your data from 16 different sources (with more to come)",
			},
			{
				text: "Integrations with 13 different services (with more on the way)",
			},
			{
				text: "Consolidated activity and statistics graphs and views across all your media",
			},
			{
				text: "Set time spent manually on seen entries for more accurate tracking of media consumption",
				isPro: true,
			},
			{
				text: "Get notifications when a new episode is released or your favorite actor is back on screen",
			},
			{
				text: "Support for 9 different notification platforms (more being released soon)",
			},
			{
				text: "Save your most commonly used filters as presets for easy access",
				isPro: true,
			},
			{
				text: "Get information on where you can watch a movie/show legally in your country",
			},
			{
				text: "Set reminders for when you want to watch something and get notified",
			},
			{ text: "Review media privately or publicly and see what others think" },
			{ text: "Browse media by genre or groups (eg: Star Wars collection)" },
			{
				text: "Calendar view to get an overview on when a media is being released",
			},
			{
				text: "Suggestions that cater to your tastes based on your watch history",
				isPro: true,
			},
			{
				text: "Integrations with YouTube Music and Jellyfin for your music collection",
				isPro: true,
			},
		],
	},
	{
		heading: "Fitness Tracking",
		title: "Transform Your Fitness Journey",
		icon: Dumbbell,
		description: {
			title: "Comprehensive Exercise Database",
			text: "Access over 800 exercises with detailed instructions, search functionality, and the ability to add your own custom exercises.",
		},
		images: [
			"current-workout.png",
			"measurements-graph.png",
			"logged-workout.png",
			"exercise-dataset.png",
		],
		features: [
			{ text: "Hit the gym and track workouts in realtime" },
			{
				text: "Dataset of over 800 exercises with instructions (and the ability to add your own)",
			},
			{ text: "Add rest timers to each set you complete" },
			{
				text: "Create supersets and upload images for each exercise to track progression",
			},
			{
				text: "Inline history and images of exercises while logging an active workout",
				isPro: true,
			},
			{ text: "Create templates to pre-plan workouts", isPro: true },
			{
				text: "Graphs of progress for exercises to visualize your progress over time",
			},
			{
				text: "Keep track of your measurements like body weight, sugar level etc.",
			},
			{
				text: "Visualizations of how your measurements fluctuate over time. Use them to identify trends and patterns.",
			},
		],
	},
	{
		heading: "Other Goodies",
		title: "Even More Amazing Features",
		icon: Sparkles,
		images: [
			"sharing.png",
			"recommendations.png",
			"sharing-form.png",
			"supercharged-collections.png",
		],
		features: [
			{
				text: "Share access links to your data with your friends and family",
				isPro: true,
			},
			{
				text: "Fine grained preferences to customize exactly what you want to track",
			},
			{
				text: "Add collaborators to your collections to allow them to add to them",
				isPro: true,
			},
			{
				text: "Dark and light mode, because Ryot is at your fingertips the whole time",
			},
			{
				text: "Add custom information to your collections to make them more personalized",
				isPro: true,
			},
		],
	},
];

const colorMap = {
	blue: {
		bg: "bg-blue-100",
		text: "text-blue-600",
	},
	green: {
		bg: "bg-green-100",
		text: "text-green-600",
	},
	purple: {
		bg: "bg-purple-100",
		text: "text-purple-600",
	},
	orange: {
		bg: "bg-orange-100",
		text: "text-orange-600",
	},
	red: {
		bg: "bg-red-100",
		text: "text-red-600",
	},
	gray: {
		bg: "bg-gray-100",
		text: "text-gray-600",
	},
};

const FEATURE_CARDS = [
	{
		icon: Play,
		color: "blue" as const,
		title: "Smart Tracking",
		description:
			"Automatically organize and categorize your media with intelligent detection and classification.",
		feature: "Auto-classification",
		featureIcon: CheckCircle,
	},
	{
		icon: BarChart3,
		color: "green" as const,
		title: "Advanced Analytics",
		description:
			"Get deep insights into your habits with beautiful charts and comprehensive statistics.",
		feature: "Beautiful charts",
		featureIcon: AreaChart,
	},
	{
		icon: Bell,
		color: "purple" as const,
		title: "Smart Notifications",
		description:
			"Never miss new releases or important updates with intelligent notification system.",
		feature: "9 Platforms",
		featureIcon: Target,
	},
	{
		icon: Share2,
		color: "orange" as const,
		title: "Social Features",
		description:
			"Share your progress and collections with friends and family members.",
		feature: "Share with friends",
		featureIcon: Users,
	},
	{
		icon: Heart,
		color: "red" as const,
		title: "Personal Collections",
		description:
			"Create custom collections and add personal touches to make them uniquely yours.",
		feature: "Custom collections",
		featureIcon: FolderHeart,
	},
	{
		icon: Lock,
		color: "gray" as const,
		title: "Privacy First",
		description:
			"Your data stays secure with self-hosting options and complete privacy control.",
		feature: "Self-hosted",
		featureIcon: CheckCircle,
	},
];
