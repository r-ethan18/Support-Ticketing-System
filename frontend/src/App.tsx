import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { AdminTicketsPage } from "./pages/admin/AdminTicketsPage";
import { UserManagementPage } from "./pages/admin/UserManagementPage";
import { AssignedTicketsPage } from "./pages/assignee/AssignedTicketsPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { CreateTicketPage } from "./pages/requester/CreateTicketPage";
import { MyTicketsPage } from "./pages/requester/MyTicketsPage";
import { RequesterDashboard } from "./pages/requester/RequesterDashboard";
import { NotFoundPage } from "./pages/shared/NotFoundPage";
import { TicketDetailPage } from "./pages/shared/TicketDetailPage";
import { SupervisorDashboard } from "./pages/supervisor/SupervisorDashboard";
import { SupervisorQueuePage } from "./pages/supervisor/SupervisorQueuePage";

function RoleRedirect() {
	const { role, isAuthenticated } = useAuth();
	if (!isAuthenticated) {
		return <Navigate to="/login" replace />;
	}

	switch (role) {
		case "requester":
			return <Navigate to="/requester/dashboard" replace />;
		case "assignee":
			return <Navigate to="/assignee/tickets" replace />;
		case "supervisor":
			return <Navigate to="/supervisor/dashboard" replace />;
		case "admin":
			return <Navigate to="/admin/dashboard" replace />;
		default:
			return <Navigate to="/login" replace />;
	}
}

function AppRoutes() {
	return (
		<Routes>
			{/* Public / Auth */}
			<Route path="/login" element={<LoginPage />} />
			<Route path="/" element={<RoleRedirect />} />

			{/* Requester Workspace */}
			<Route
				path="/requester/dashboard"
				element={
					<AppShell pageTitle="Requester Dashboard">
						<RequesterDashboard />
					</AppShell>
				}
			/>
			<Route
				path="/requester/tickets"
				element={
					<AppShell pageTitle="My Tickets">
						<MyTicketsPage />
					</AppShell>
				}
			/>
			<Route
				path="/requester/tickets/new"
				element={
					<AppShell pageTitle="Submit Service Ticket">
						<CreateTicketPage />
					</AppShell>
				}
			/>
			<Route
				path="/requester/tickets/:id"
				element={
					<AppShell pageTitle="Ticket Details">
						<TicketDetailPage />
					</AppShell>
				}
			/>

			{/* Assignee Workspace */}
			<Route
				path="/assignee/tickets"
				element={
					<AppShell pageTitle="Assigned Work Queue">
						<AssignedTicketsPage />
					</AppShell>
				}
			/>
			<Route
				path="/assignee/tickets/:id"
				element={
					<AppShell pageTitle="Field Service Workspace">
						<TicketDetailPage />
					</AppShell>
				}
			/>

			{/* Supervisor Workspace */}
			<Route
				path="/supervisor/dashboard"
				element={
					<AppShell pageTitle="Supervisor Overview">
						<SupervisorDashboard />
					</AppShell>
				}
			/>
			<Route
				path="/supervisor/queue"
				element={
					<AppShell pageTitle="Department Triage Queue">
						<SupervisorQueuePage />
					</AppShell>
				}
			/>
			<Route
				path="/supervisor/tickets/:id"
				element={
					<AppShell pageTitle="Ticket Management">
						<TicketDetailPage />
					</AppShell>
				}
			/>

			{/* Administrator Workspace */}
			<Route
				path="/admin/dashboard"
				element={
					<AppShell pageTitle="System Administration">
						<AdminDashboard />
					</AppShell>
				}
			/>
			<Route
				path="/admin/users"
				element={
					<AppShell pageTitle="Personnel & Access Management">
						<UserManagementPage />
					</AppShell>
				}
			/>
			<Route
				path="/admin/tickets"
				element={
					<AppShell pageTitle="Global Ticket Database">
						<AdminTicketsPage />
					</AppShell>
				}
			/>
			<Route
				path="/admin/tickets/:id"
				element={
					<AppShell pageTitle="Ticket Administration">
						<TicketDetailPage />
					</AppShell>
				}
			/>

			{/* Fallback 404 */}
			<Route path="*" element={<NotFoundPage />} />
		</Routes>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<ToastProvider>
				<AuthProvider>
					<AppRoutes />
				</AuthProvider>
			</ToastProvider>
		</BrowserRouter>
	);
}
