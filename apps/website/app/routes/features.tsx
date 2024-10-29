import { logoUrl } from "~/lib/utils";

export default function Page() {
	return (
		<div>
			<div className="bg-muted py-32">
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
		</div>
	);
}
