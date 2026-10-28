import {
	ArrowRight,
	CheckCircle2,
	Clock,
	Layers,
	PlusCircle,
	Ticket as TicketIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PriorityBadge, StatusBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { CardSkeleton, TableSkeleton } from "../../components/common/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { ticketService } from "../../services/ticketService";
import type { Ticket } from "../../types/api";

export function RequesterDashboard() {
	const { user } = useAuth();
	const navigate = useNavigate();
	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadDashboardTickets() {
			try {
				setLoading(true);
				const res = await ticketService.listTickets({
					callerRole: "requester",
					callerId: user?.id,
					limit: 5,
					sortBy: "createdAt",
					order: "desc",
				});
				setTickets(res.items);
			} catch (err) {
				console.error("Failed to load requester dashboard tickets", err);
			} finally {
				setLoading(false);
			}
		}
		loadDashboardTickets();
	}, [user?.id]);

	const totalTickets = tickets.length;
	const openTickets = tickets.filter(
		(t) => t.status === "open" || t.status === "assigned",
	).length;
	const inProgressTickets = tickets.filter(
		(t) => t.status === "in_progress",
	).length;
	const resolvedTickets = tickets.filter(
		(t) => t.status === "resolved" || t.status === "closed",
	).length;

	return (
		<div className="page-wrapper">
			{/* Welcome Greeting Banner */}
			<div className="welcome-banner">
				<div className="welcome-text">
					<h2 className="welcome-title">
						Welcome back, {user?.name || "Requester"}
					</h2>
					<p className="welcome-subtitle">
						Monitor your submitted incidents, review field technician updates,
						or submit a new service request.
					</p>
				</div>
				<Button
					variant="primary"
					icon={<PlusCircle size={16} />}
					onClick={() => navigate("/requester/tickets/new")}
				>
					New Service Ticket
				</Button>
			</div>

			{/* Metric KPI Cards */}
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
							<div className="stat-icon-wrap bg-blue-subtle text-blue">
								<TicketIcon size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Total Submitted</span>
								<span className="stat-value">{totalTickets}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-amber-subtle text-amber">
								<Clock size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Pending / Open</span>
								<span className="stat-value">{openTickets}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-indigo-subtle text-indigo">
								<Layers size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">In Progress</span>
								<span className="stat-value">{inProgressTickets}</span>
							</div>
						</div>

						<div className="stat-card">
							<div className="stat-icon-wrap bg-emerald-subtle text-emerald">
								<CheckCircle2 size={20} />
							</div>
							<div className="stat-content">
								<span className="stat-label">Resolved / Closed</span>
								<span className="stat-value">{resolvedTickets}</span>
							</div>
						</div>
					</>
				)}
			</div>

			{/* Recent Tickets Section */}
			<div className="section-card">
				<div className="section-card-header">
					<div>
						<h3 className="section-card-title">Recent Tickets</h3>
						<p className="section-card-sub">
							Your latest service issues and dispatch updates
						</p>
					</div>
					<Link to="/requester/tickets" className="view-all-link">
						<span>View all tickets</span>
						<ArrowRight size={14} />
					</Link>
				</div>

				{loading ? (
					<TableSkeleton rows={3} cols={5} />
				) : tickets.length === 0 ? (
					<EmptyState
						title="No tickets submitted yet"
						description="When you encounter an equipment or facility issue, report it here."
						action={
							<Button
								variant="primary"
								size="sm"
								icon={<PlusCircle size={14} />}
								onClick={() => navigate("/requester/tickets/new")}
							>
								Submit your first ticket
							</Button>
						}
					/>
				) : (
					<div className="table-responsive">
						<table className="data-table">
							<thead>
								<tr>
									<th>Ticket</th>
									<th>Location</th>
									<th>Priority</th>
									<th>Status</th>
									<th>Created</th>
									<th className="text-right">Action</th>
								</tr>
							</thead>
							<tbody>
								{tickets.map((ticket) => (
									<tr
										key={ticket.id}
										className="clickable-row"
										onClick={() => navigate(`/requester/tickets/${ticket.id}`)}
									>
										<td className="font-medium text-slate">
											<div className="ticket-title-cell">
												<span className="ticket-id-tag">#{ticket.id}</span>
												<span className="ticket-title-text">
													{ticket.title}
												</span>
											</div>
										</td>
										<td className="text-secondary">{ticket.location}</td>
										<td>
											<PriorityBadge priority={ticket.priority} size="sm" />
										</td>
										<td>
											<StatusBadge status={ticket.status} size="sm" />
										</td>
										<td className="text-secondary text-sm">
											{new Date(ticket.createdAt).toLocaleDateString(
												undefined,
												{
													month: "short",
													day: "numeric",
													hour: "2-digit",
													minute: "2-digit",
												},
											)}
										</td>
										<td className="text-right">
											<Button
												variant="ghost"
												size="sm"
												onClick={(e) => {
													e.stopPropagation();
													navigate(`/requester/tickets/${ticket.id}`);
												}}
											>
												View
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
