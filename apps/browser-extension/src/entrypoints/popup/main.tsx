import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./app.tsx";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
