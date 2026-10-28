import {
	AlertCircle,
	ArrowRight,
	Inbox,
	Layers,
	UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar } from "../../components/common/Avatar";
import { PriorityBadge, StatusBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { CardSkeleton, TableSkeleton } from "../../components/common/Skeleton";
import { ticketService } from "../../services/ticketService";
import type { Person, Ticket } from "../../types/api";

export function SupervisorDashboard() {
	const navigate = useNavigate();

	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [techs, setTechs] = useState<Person[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadSupervisorData() {
			try {
				setLoading(true);
				const [ticketRes, people] = await Promise.all([
					ticketService.listTickets({ limit: 50 }),
					ticketService.listPeople(),
				]);

				setTickets(ticketRes.items);
				setTechs(people.filter((p) => p.role === "assignee"));
			} catch (err) {
				console.error("Failed to load supervisor data", err);
			} finally {
				setLoading(false);
			}
		}
		loadSupervisorData();
	}, []);

	const unassignedTickets = tickets.filter((t) => t.status === "open");
	const inProgressTickets = tickets.filter((t) => t.status === "in_progress");
	const criticalTickets = tickets.filter(
		(t) => t.priority === "critical" && t.status !== "closed",
	);

	return (
		<div className="page-wrapper">
			{/* Supervisor Welcome Header */}
			<div className="welcome-banner">
				<div className="welcome-text">
					<h2 className="welcome-title">Supervisor Management Console</h2>
					<p className="welcome-subtitle">
						Monitor department triage, dispatch available field technicians, and
						track service level agreements.
					</p>
				</div>
				<Button
					variant="primary"
					icon={<Inbox size={16} />}
					onClick={() => navigate("/supervisor/queue")}
				>
					Open Triage Queue
				</Button>
			</div>

			{/* KPI Metrics */}
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
							<div className="stat-icon-wrap bg-amber-subtle text-amber">
								<Inbox size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Unassigned Tickets</span>
								<span className="stat-value text-amber">
									{unassignedTickets.length}
								</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-indigo-subtle text-indigo">
								<Layers size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">In Progress</span>
								<span className="stat-value">{inProgressTickets.length}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-red-subtle text-danger">
								<AlertCircle size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Critical Incidents</span>
								<span className="stat-value text-danger">
									{criticalTickets.length}
								</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-emerald-subtle text-emerald">
								<UserCheck size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Active Field Techs</span>
								<span className="stat-value">{techs.length}</span>
							</div>
						</div>
					</>
				)}
			</div>

			{/* Urgent Unassigned Triage Callout */}
			{unassignedTickets.length > 0 && (
				<div className="alert-banner-warning mb-6">
					<div className="banner-left">
						<AlertCircle size={20} className="text-amber" />
						<div>
							<h4 className="font-semibold text-slate">
								{unassignedTickets.length} Unassigned Tickets Require Dispatch
							</h4>
							<p className="text-secondary text-sm">
								Newly logged incidents must be assigned to field technicians to
								begin resolution.
							</p>
						</div>
					</div>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => navigate("/supervisor/queue?status=open")}
					>
						Dispatch Now
					</Button>
				</div>
			)}

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				{/* Recent Department Incidents */}
				<div className="card col-span-2">
					<div className="section-card-header">
						<div>
							<h3 className="section-card-title">Department Queue Activity</h3>
							<p className="section-card-sub">
								Latest incidents reported across facilities
							</p>
						</div>
						<Link to="/supervisor/queue" className="view-all-link">
							<span>Full Queue</span>
							<ArrowRight size={14} />
						</Link>
					</div>

					{loading ? (
						<TableSkeleton rows={4} cols={5} />
					) : (
						<div className="table-responsive">
							<table className="data-table">
								<thead>
									<tr>
										<th>Ticket</th>
										<th>Priority</th>
										<th>Status</th>
										<th>Action</th>
									</tr>
								</thead>
								<tbody>
									{tickets.slice(0, 5).map((t) => (
										<tr
											key={t.id}
											className="clickable-row"
											onClick={() => navigate(`/supervisor/tickets/${t.id}`)}
										>
											<td>
												<div className="ticket-title-cell">
													<span className="ticket-id-tag">#{t.id}</span>
													<span className="ticket-title-text font-medium">
														{t.title}
													</span>
												</div>
											</td>
											<td>
												<PriorityBadge priority={t.priority} size="sm" />
											</td>
											<td>
												<StatusBadge status={t.status} size="sm" />
											</td>
											<td>
												<Button
													variant="ghost"
													size="sm"
													onClick={(e) => {
														e.stopPropagation();
														navigate(`/supervisor/tickets/${t.id}`);
													}}
												>
													Manage
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Field Technicians Availability Roster */}
				<div className="card">
					<div className="section-card-header">
						<div>
							<h3 className="section-card-title">Technician Roster</h3>
							<p className="section-card-sub">
								Field technician dispatch status
							</p>
						</div>
					</div>

					<div className="technician-list">
						{techs.map((tech) => (
							<div key={tech.id} className="technician-item">
								<Avatar name={tech.name} size="sm" />
								<div className="tech-info">
									<span className="tech-name">{tech.name}</span>
									<span className="tech-sub">{tech.email}</span>
								</div>
								<span className="badge badge-sm badge-neutral">Ready</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
