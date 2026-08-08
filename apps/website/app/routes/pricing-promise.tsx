import { ShieldCheck } from "lucide-react";
import { SectionHeader } from "~/lib/components/SectionHeader";
import { Card } from "~/lib/components/ui/card";

export const meta = () => {
	return [{ title: "Pricing Promise | Ryot" }];
};

export default function Page() {
	return (
		<section className="py-10 lg:py-20 bg-muted/30">
			<div className="max-w-4xl mx-auto px-4">
				<SectionHeader
					as="h1"
					icon={ShieldCheck}
					badgeVariant="secondary"
					subtitle="Pricing Promise"
					title="Our pricing promise"
					description="Ryot's prices will go up over time. Yours won't."
				/>

				<Card>
					<div className="p-6 sm:p-10 space-y-6 text-lg text-muted-foreground leading-relaxed">
						<p>
							Subscribe today and you keep the rate you signed up at, for as
							long as your subscription stays active. That applies to every
							future price change. We don't move existing customers onto new
							pricing.
						</p>
						<p>
							Buy a lifetime license and it's yours permanently. No renewal, no
							expiry, no reconsidering.
						</p>
						<p>
							One boundary, stated now so it isn't a surprise later: if your
							subscription lapses and you resubscribe, you return at the current
							price. Your old rate goes with the old subscription. If a payment
							fails, email us - we'll fix it and keep your rate. That's not a
							loophole we're looking to use.
						</p>
						<p>
							We'd rather charge new customers more than break a deal with the
							people who backed us first.
						</p>
					</div>
				</Card>
			</div>
		</section>
	);
}
