import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => {
	return [
		{ title: "New Remix App" },
		{ name: "description", content: "Welcome to Remix!" },
	];
};

export default function Index() {
	return (
		<div>
			<h1>Wow this is perfect!</h1>
			<h2>Hello world!</h2>
			<p>Does it work?</p>
		</div>
	);
}
