import { Gift, Rocket, Shield, Star } from "lucide-react";

export const getIcon = (name: string) => {
	switch (name.toLowerCase()) {
		case "free":
			return <Shield className="w-5 h-5 text-gray-600" />;
		case "monthly":
			return <Rocket className="w-5 h-5 text-blue-600" />;
		case "yearly":
			return <Star className="w-5 h-5 text-white" />;
		case "lifetime":
			return <Gift className="w-5 h-5 text-purple-600" />;
		default:
			return <Star className="w-5 h-5 text-primary" />;
	}
};

export const getIconBg = (name: string) => {
	switch (name.toLowerCase()) {
		case "free":
			return "bg-gray-100";
		case "monthly":
			return "bg-blue-100";
		case "yearly":
			return "bg-gradient-to-br from-primary to-primary/80";
		case "lifetime":
			return "bg-purple-100";
		default:
			return "bg-primary/10";
	}
};

export const isPopular = (name: string) => name.toLowerCase() === "yearly";
