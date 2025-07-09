import { useEffect, useState } from "react";
import { storage } from "#imports";

const STORAGE_KEY = "local:integration-url";

const App = () => {
	const [url, setUrl] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [urlError, setUrlError] = useState("");

	const validateUrl = (urlString: string) => {
		if (!urlString.trim()) {
			setUrlError("");
			return false;
		}

		try {
			const url = new URL(urlString);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				setUrlError("URL must start with http:// or https://");
				return false;
			}
			setUrlError("");
			return true;
		} catch {
			setUrlError("Please enter a valid URL");
			return false;
		}
	};

	useEffect(() => {
		const loadSavedUrl = async () => {
			const savedUrl = await storage.getItem<string>(STORAGE_KEY);
			if (savedUrl) {
				setUrl(savedUrl);
				validateUrl(savedUrl);
			}
		};

		loadSavedUrl();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateUrl(url)) return;

		setIsSubmitting(true);
		await storage.setItem(STORAGE_KEY, url);
		setSubmitted(true);
		setTimeout(() => setSubmitted(false), 2000);
		setIsSubmitting(false);
	};

	const handleClear = async () => {
		await storage.removeItem(STORAGE_KEY);
		setUrl("");
		setUrlError("");
	};

	return (
		<div className="w-[300px] p-5 font-sans">
			<h1 className="text-center m-0 mb-5 text-2xl font-semibold text-gray-800">
				Ryot
			</h1>
			<form onSubmit={handleSubmit} className="flex flex-col gap-3">
				<label
					htmlFor="url-input"
					className="text-sm font-medium text-gray-600 mb-1"
				>
					Integration URL
				</label>
				<input
					type="text"
					value={url}
					id="url-input"
					className={`w-full py-2.5 px-3 border-2 rounded-md text-sm transition-colors box-border focus:outline-none ${urlError ? "border-red-500 focus:border-red-500" : "border-gray-300 focus:border-blue-600"}`}
					onChange={(e) => {
						const newUrl = e.target.value;
						setUrl(newUrl);
						validateUrl(newUrl);
					}}
					placeholder="Enter your integration URL"
				/>
				{urlError && (
					<div className="text-red-500 text-xs mt-1">{urlError}</div>
				)}
				<div className="flex gap-2 mt-2">
					<button
						type="submit"
						className="flex-[2] py-2.5 px-4 bg-blue-600 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
						disabled={isSubmitting || !url.trim() || !!urlError}
					>
						{isSubmitting ? "Saving..." : submitted ? "Saved!" : "Submit"}
					</button>
					{url.trim() && (
						<button
							type="button"
							onClick={handleClear}
							className="flex-1 py-2.5 px-4 bg-red-500 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-red-600"
						>
							Clear
						</button>
					)}
				</div>
			</form>
		</div>
	);
};

export default App;
