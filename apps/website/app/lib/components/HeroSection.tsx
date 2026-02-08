import { cn } from "@ryot/ts-utils";
import { Star } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "~/lib/components/ui/badge";
import { Button } from "~/lib/components/ui/button";
import { SECTION_CONTAINER, SECTION_Y_PADDING_LARGE } from "~/lib/styles";

type ImageProps = {
	src: string;
	alt: string;
	className: string;
};

const Image = (props: ImageProps) => (
	<img
		src={props.src}
		alt={props.alt}
		className={cn(
			props.className,
			"mx-auto aspect-video overflow-hidden rounded-xl object-cover",
		)}
	/>
);

const demoLink = "https://demo.ryot.io/_s/acl_QQ7Bb9JvtOrj";

export const HeroSection = () => {
	return (
		<section
			className={cn("relative", SECTION_Y_PADDING_LARGE, "overflow-hidden")}
		>
			<div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-accent/5" />
			<div className={cn(SECTION_CONTAINER, "relative")}>
				<div className="grid lg:grid-cols-2 gap-12 items-center">
					<div className="max-w-2xl">
						<Badge className="mb-6" variant="secondary">
							<Star className="w-4 h-4 mr-2" />
							Trusted by thousands
						</Badge>
						<h1 className="text-4xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
							Track Your Life, Your Way with{" "}
							<span className="text-primary">Ryot</span>
						</h1>
						<p className="text-lg text-muted-foreground mb-8 leading-relaxed">
							The ultimate personal tracking platform that helps you monitor
							your media consumption, fitness progress, and daily habits all in
							one place. Say goodbye to scattered spreadsheets and hello to
							organized insights.
						</p>
						<div className="flex flex-col sm:flex-row gap-4">
							<Button asChild size="lg" className="text-base px-8">
								<Link to="#start-here">Start Free Trial</Link>
							</Button>
							<Button
								asChild
								size="lg"
								variant="outline"
								className="text-base px-8"
							>
								<a href={demoLink} target="_blank" rel="noopener noreferrer">
									Try Live Demo
								</a>
							</Button>
						</div>
					</div>
					<div className="relative">
						<div className="absolute inset-0 bg-linear-to-r from-primary/20 to-accent/20 blur-3xl rounded-full" />
						<Image
							src="/cta-image.png"
							className="relative w-full max-w-2xl mx-auto rounded-2xl"
							alt="Ryot Dashboard Interface showing media tracking capabilities"
						/>
					</div>
				</div>
			</div>
		</section>
	);
};
