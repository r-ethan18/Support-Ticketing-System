import {
	Building2,
	Compass,
	Layers,
	RefreshCw,
	Server,
	Truck,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { CardSkeleton } from "../../components/common/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ticketService } from "../../services/ticketService";
import type { Department, Person, Ticket, Vendor } from "../../types/api";

export function AdminDashboard() {
	const { mockMode, resetDemoData } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();

	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [people, setPeople] = useState<Person[]>([]);
	const [departments, setDepartments] = useState<Department[]>([]);
	const [vendors, setVendors] = useState<Vendor[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadAdminData() {
			try {
				setLoading(true);
				const [ticketRes, loadedPeople, loadedDepts, loadedVendors] =
					await Promise.all([
						ticketService.listTickets({ limit: 100 }),
						ticketService.listPeople(),
						ticketService.listDepartments(),
						ticketService.listVendors(),
					]);

				setTickets(ticketRes.items);
				setPeople(loadedPeople);
				setDepartments(loadedDepts);
				setVendors(loadedVendors);
			} catch (err) {
				console.error("Failed to load admin stats", err);
			} finally {
				setLoading(false);
			}
		}

		loadAdminData();
	}, []);

	const handleReset = () => {
		resetDemoData();
		showToast("Initialized demo records across all roles", "success");
		window.location.reload();
	};

	return (
		<div className="page-wrapper">
			<div className="welcome-banner">
				<div className="welcome-text">
					<h2 className="welcome-title">Enterprise System Administration</h2>
					<p className="welcome-subtitle">
						Monitor cross-department ticketing operations, configure staff
						roles, and audit service delivery infrastructure.
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="secondary"
						icon={<Users size={16} />}
						onClick={() => navigate("/admin/users")}
					>
						Manage Users
					</Button>
					<Button
						variant="primary"
						icon={<Compass size={16} />}
						onClick={() => navigate("/admin/tickets")}
					>
						Global Ticket DB
					</Button>
				</div>
			</div>

			{/* KPI Statistics */}
			<div className="stats-grid">
				{loading ? (
					<>
						<CardSkeleton />
						<CardSkeleton />
						<CardSkeleton />
						<CardSkeleton />
					</>
				) : (
					<>
						<div className="stat-card">
							<div className="stat-icon-wrap bg-indigo-subtle text-indigo">
								<Layers size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Total Enterprise Tickets</span>
								<span className="stat-value">{tickets.length}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-blue-subtle text-blue">
								<Users size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Registered Personnel</span>
								<span className="stat-value">{people.length}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-emerald-subtle text-emerald">
								<Building2 size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Operating Departments</span>
								<span className="stat-value">{departments.length}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-amber-subtle text-amber">
								<Truck size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Service Contractors</span>
								<span className="stat-value">{vendors.length}</span>
							</div>
						</div>
					</>
				)}
			</div>

			{/* System Infrastructure & API Diagnostics Card */}
			<div className="card mb-6">
				<div className="section-card-header">
					<div>
						<h3 className="section-card-title flex items-center gap-2">
							<Server size={18} className="text-primary" />
							<span>System Architecture & API Connectivity</span>
						</h3>
						<p className="section-card-sub">
							Live operational status of backend services and frontend proxy
							routing
						</p>
					</div>

					<Button
						variant="outline"
						size="sm"
						icon={<RefreshCw size={14} />}
						onClick={handleReset}
					>
						Reset Mock Store
					</Button>
				</div>

				<div className="admin-diagnostics-grid">
					<div className="diag-item">
						<span className="diag-label">Frontend Dev / Deploy Port</span>
						<span className="diag-val text-primary font-mono">
							3000 (localhost:3000)
						</span>
						<span className="diag-sub">Mapped to Traefik proxy</span>
					</div>

					<div className="diag-item">
						<span className="diag-label">API Gateway Path</span>
						<span className="diag-val text-emerald font-mono">
							/api/v1/* &rarr; :8000
						</span>
						<span className="diag-sub">FastAPI backend upstream</span>
					</div>

					<div className="diag-item">
						<span className="diag-label">Data Persistence Mode</span>
						<span
							className={`diag-val font-semibold ${mockMode ? "text-amber" : "text-blue"}`}
						>
							{mockMode ? "Reactive Mock Mode" : "Live API Gateway Mode"}
						</span>
						<span className="diag-sub">
							{mockMode ? "LocalStorage demo store" : "HTTP 501 fallback alert"}
						</span>
					</div>

					<div className="diag-item">
						<span className="diag-label">Authentication Mechanism</span>
						<span className="diag-val font-mono">POST /api/v1/auth/token</span>
						<span className="diag-sub">Bearer JWT format</span>
					</div>
				</div>
			</div>

			{/* Quick Role Capabilities Card */}
			<div className="card">
				<h3 className="section-card-title mb-2">Role Permissions Matrix</h3>
				<p className="section-card-sub mb-4">
					System access rules enforced by SupportDesk RBAC architecture
				</p>

				<div className="table-responsive">
					<table className="data-table">
						<thead>
							<tr>
								<th>Role</th>
								<th>Ticket Access</th>
								<th>Assignment Rights</th>
								<th>Personnel Admin</th>
								<th>Attachment Capabilities</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td className="font-semibold text-slate">Requester</td>
								<td>Own submitted tickets only</td>
								<td>None</td>
								<td>None</td>
								<td>Issue evidence photos</td>
							</tr>
							<tr>
								<td className="font-semibold text-slate">Assignee</td>
								<td>Tickets assigned to self</td>
								<td>Status updates only</td>
								<td>None</td>
								<td>Completion proof uploads</td>
							</tr>
							<tr>
								<td className="font-semibold text-slate">Supervisor</td>
								<td>All department tickets</td>
								<td>Assign / reassign technicians</td>
								<td>Department roster view</td>
								<td>Evidence & review</td>
							</tr>
							<tr>
								<td className="font-semibold text-slate">Administrator</td>
								<td>Entire database (cross-dept)</td>
								<td>Full assignment override</td>
								<td>Create / update accounts</td>
								<td>Full media audit</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
