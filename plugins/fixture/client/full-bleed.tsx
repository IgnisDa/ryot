import { usePluginTitle, useRyotSafeArea } from "@ryot-app/client-sdk/plugin";
import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";

export const FullBleed = () => {
	const ryot = useRyot();
	const safeAreaTop = useRyotSafeArea();
	usePluginTitle("Fixture full-bleed");

	return (
		<main className="min-h-full w-full bg-bg text-text">
			<div
				style={{ paddingTop: safeAreaTop }}
				className="flex flex-col items-center gap-2 bg-accent-soft px-4 pb-6"
			>
				<p data-testid="fixture-safe-area" className="pt-4 text-sm text-text-muted">
					Safe-area inset: {safeAreaTop}px
				</p>
				<h1 className="font-display text-2xl">Full-bleed screen</h1>
			</div>
			<div className="flex flex-col items-center gap-4 px-4 py-6">
				<p className="max-w-md text-center text-text-muted">
					This screen renders no header frame. It paints under the status bar itself and owns its
					own way back, so the drawer is only reachable by the left-edge gesture here.
				</p>
				<Button onClick={() => ryot.navigation.replace({ path: "/" })}>Back to home</Button>
			</div>
		</main>
	);
};
