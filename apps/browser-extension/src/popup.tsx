import { useState } from "react";

function Page() {
	const [data, setData] = useState("");

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				padding: 16,
				width: 300,
			}}
		>
			<h2>
				Welcome to your
				<a href="https://www.plasmo.com" target="_blank" rel="noreferrer">
					{" "}
					Plasmo
				</a>{" "}
				Extension!
			</h2>
			<p>Your input: {data}</p>
			<input onChange={(e) => setData(e.target.value)} value={data} />
			<a href="https://docs.plasmo.com" target="_blank" rel="noreferrer">
				View Docs
			</a>
		</div>
	);
}

export default Page;
