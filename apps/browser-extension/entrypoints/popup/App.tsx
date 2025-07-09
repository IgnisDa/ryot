import { useEffect, useState } from "react";
import { storage } from "#imports";
import "./App.css";

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
		<div className="app">
			<h1 className="title">Ryot</h1>
			<form onSubmit={handleSubmit} className="form">
				<label htmlFor="url-input" className="label">
					Integration URL
				</label>
				<input
					type="text"
					value={url}
					id="url-input"
					className={`input ${urlError ? "input-error" : ""}`}
					onChange={(e) => {
						const newUrl = e.target.value;
						setUrl(newUrl);
						validateUrl(newUrl);
					}}
					placeholder="Enter your integration URL"
				/>
				{urlError && <div className="error-message">{urlError}</div>}
				<div className="button-container">
					<button
						type="submit"
						className="submit-button"
						disabled={isSubmitting || !url.trim() || !!urlError}
					>
						{isSubmitting ? "Saving..." : submitted ? "Saved!" : "Submit"}
					</button>
					{url.trim() && (
						<button
							type="button"
							onClick={handleClear}
							className="clear-button"
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
