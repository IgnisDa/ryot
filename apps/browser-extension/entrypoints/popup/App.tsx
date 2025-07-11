import { useEffect, useState } from "react";
import { storage } from "#imports";
import { STORAGE_KEYS } from "../../lib/constants";
import type { FormState } from "../../types/progress";

const App = () => {
	const [url, setUrl] = useState("");
	const [formState, setFormState] = useState<FormState>({ status: "idle" });

	const validateUrl = (urlString: string) => {
		if (!urlString.trim()) {
			setFormState((prev) => ({ ...prev, error: undefined }));
			return false;
		}

		try {
			const url = new URL(urlString);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				setFormState((prev) => ({
					...prev,
					error: "URL must start with http:// or https://",
				}));
				return false;
			}
			setFormState((prev) => ({ ...prev, error: undefined }));
			return true;
		} catch {
			setFormState((prev) => ({ ...prev, error: "Please enter a valid URL" }));
			return false;
		}
	};

	useEffect(() => {
		const loadSavedUrl = async () => {
			const savedUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);
			if (savedUrl) {
				setUrl(savedUrl);
				validateUrl(savedUrl);
				setFormState({ status: "submitted" });
			}
		};

		loadSavedUrl();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateUrl(url)) return;

		setFormState({ status: "submitting" });
		await storage.setItem(STORAGE_KEYS.INTEGRATION_URL, url);
		setFormState({ status: "submitted" });
	};

	const handleClear = async () => {
		await storage.removeItem(STORAGE_KEYS.INTEGRATION_URL);
		setUrl("");
		setFormState({ status: "idle" });
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
					className={`w-full py-2.5 px-3 border-2 rounded-md text-sm transition-colors box-border focus:outline-none ${formState.error ? "border-red-500 focus:border-red-500" : "border-gray-300 focus:border-blue-600"}`}
					onChange={(e) => {
						const newUrl = e.target.value;
						setUrl(newUrl);
						validateUrl(newUrl);
					}}
					placeholder="Enter your integration URL"
				/>
				{formState.error && (
					<div className="text-red-500 text-xs mt-1">{formState.error}</div>
				)}
				<div className="flex gap-2 mt-2">
					{formState.status !== "submitted" && (
						<button
							type="submit"
							className="flex-[2] py-2.5 px-4 bg-blue-600 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
							disabled={
								formState.status === "submitting" ||
								!url.trim() ||
								!!formState.error
							}
						>
							{formState.status === "submitting" ? "Saving..." : "Submit"}
						</button>
					)}
					{url.trim() && (
						<button
							type="button"
							onClick={handleClear}
							className={`py-2.5 px-4 bg-red-500 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-colors hover:bg-red-600 ${formState.status === "submitted" ? "w-full" : "flex-1"}`}
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
