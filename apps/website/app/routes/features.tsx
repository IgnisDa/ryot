import { logoUrl } from "~/lib/utils";

export default function Page() {
	return (
		<section id="features" className="w-full py-32 bg-muted">
			<div className="space-y-4 flex flex-col items-center justify-center">
				<img src={logoUrl} alt="Ryot" className="size-28 lg:size-40" />
				<h1 className="text-center text-2xl lg:text-3xl">
					Think of Ryot as your second brain with superpowers ✨
				</h1>
				<h2 className="text-center lg:text-xl text-gray-500">
					What all can Ryot do for you?
				</h2>
			</div>
		</section>
	);
}
