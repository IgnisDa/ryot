import { useEffect, useState } from "react";
import { storage } from "#imports";
import "./App.css";

const STORAGE_KEY = "local:integration-url";

const App = () => {
	const [url, setUrl] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);

	useEffect(() => {
		const loadSavedUrl = async () => {
			const savedUrl = await storage.getItem<string>(STORAGE_KEY);
			if (savedUrl) setUrl(savedUrl);
		};

		loadSavedUrl();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsSubmitting(true);

		await storage.setItem(STORAGE_KEY, url);
		setSubmitted(true);
		setTimeout(() => setSubmitted(false), 2000);
		setIsSubmitting(false);
	};

	const handleClear = async () => {
		await storage.removeItem(STORAGE_KEY);
		setUrl("");
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
					className="input"
					onChange={(e) => setUrl(e.target.value)}
					placeholder="Enter your integration URL"
				/>
				<div className="button-container">
					<button
						type="submit"
						className="submit-button"
						disabled={isSubmitting || !url.trim()}
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
