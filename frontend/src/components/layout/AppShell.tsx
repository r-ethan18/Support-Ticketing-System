import { type ReactNode, useState } from "react";
import { ToastContainer } from "../common/ToastContainer";
import { Sidebar } from "./Sidebar";
import { TopNavbar } from "./TopNavbar";

interface AppShellProps {
	children: ReactNode;
	pageTitle?: string;
}

export function AppShell({ children, pageTitle }: AppShellProps) {
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

	return (
		<div className="app-layout">
			<Sidebar
				mobileOpen={mobileSidebarOpen}
				onCloseMobile={() => setMobileSidebarOpen(false)}
			/>
			<div className="main-wrapper">
				<TopNavbar
					pageTitle={pageTitle}
					onToggleMobileSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
				/>
				<main className="content-container">{children}</main>
			</div>
			<ToastContainer />
		</div>
	);
}
