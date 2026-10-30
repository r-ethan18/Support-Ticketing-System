import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
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
import type { Role } from "./types/api";

function RoleRedirect() {
	const { role, isAuthenticated, loading } = useAuth();
	if (loading) {
		return null;
	}
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

function ProtectedRoute({
	children,
	allowedRoles,
}: {
	children: ReactNode;
	allowedRoles?: Role[];
}) {
	const { isAuthenticated, role, loading } = useAuth();

	if (loading) {
		return null;
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" replace />;
	}

	if (allowedRoles && !allowedRoles.includes(role)) {
		return <RoleRedirect />;
	}

	return <>{children}</>;
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
					<ProtectedRoute allowedRoles={["requester", "admin"]}>
						<AppShell pageTitle="Requester Dashboard">
							<RequesterDashboard />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/requester/tickets"
				element={
					<ProtectedRoute allowedRoles={["requester", "admin"]}>
						<AppShell pageTitle="My Tickets">
							<MyTicketsPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/requester/tickets/new"
				element={
					<ProtectedRoute allowedRoles={["requester", "admin"]}>
						<AppShell pageTitle="Submit Service Ticket">
							<CreateTicketPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/requester/tickets/:id"
				element={
					<ProtectedRoute allowedRoles={["requester", "admin"]}>
						<AppShell pageTitle="Ticket Details">
							<TicketDetailPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>

			{/* Assignee Workspace */}
			<Route
				path="/assignee/tickets"
				element={
					<ProtectedRoute allowedRoles={["assignee", "admin"]}>
						<AppShell pageTitle="Assigned Work Queue">
							<AssignedTicketsPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/assignee/tickets/:id"
				element={
					<ProtectedRoute allowedRoles={["assignee", "admin"]}>
						<AppShell pageTitle="Field Service Workspace">
							<TicketDetailPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>

			{/* Supervisor Workspace */}
			<Route
				path="/supervisor/dashboard"
				element={
					<ProtectedRoute allowedRoles={["supervisor", "admin"]}>
						<AppShell pageTitle="Supervisor Overview">
							<SupervisorDashboard />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/supervisor/queue"
				element={
					<ProtectedRoute allowedRoles={["supervisor", "admin"]}>
						<AppShell pageTitle="Department Triage Queue">
							<SupervisorQueuePage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/supervisor/tickets/:id"
				element={
					<ProtectedRoute allowedRoles={["supervisor", "admin"]}>
						<AppShell pageTitle="Ticket Management">
							<TicketDetailPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>

			{/* Administrator Workspace */}
			<Route
				path="/admin/dashboard"
				element={
					<ProtectedRoute allowedRoles={["admin"]}>
						<AppShell pageTitle="System Administration">
							<AdminDashboard />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/admin/users"
				element={
					<ProtectedRoute allowedRoles={["admin"]}>
						<AppShell pageTitle="Personnel & Access Management">
							<UserManagementPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/admin/tickets"
				element={
					<ProtectedRoute allowedRoles={["admin"]}>
						<AppShell pageTitle="Global Ticket Database">
							<AdminTicketsPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/admin/tickets/:id"
				element={
					<ProtectedRoute allowedRoles={["admin"]}>
						<AppShell pageTitle="Ticket Administration">
							<TicketDetailPage />
						</AppShell>
					</ProtectedRoute>
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
			<ThemeProvider>
				<ToastProvider>
					<AuthProvider>
						<AppRoutes />
					</AuthProvider>
				</ToastProvider>
			</ThemeProvider>
		</BrowserRouter>
	);
}
