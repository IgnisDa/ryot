import { component$, Slot } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";

export const useServerTimeLoader = routeLoader$(() => {
	return {
		date: new Date().toISOString(),
	};
});

export default component$(() => {
	return (
		<div class="min-h-screen flex flex-col">
			<header class="flex-none">This is a header</header>
			<main class="flex-grow bg-slate-900 text-slate-200">
				<Slot />
			</main>
			<div class="flex-none">
				<div>This is a footer</div>
			</div>
		</div>
	);
});
