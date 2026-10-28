import {
	AlertTriangle,
	CheckSquare,
	Clock,
	Layers,
	Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PriorityBadge, StatusBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { Input } from "../../components/common/Input";
import { Select } from "../../components/common/Select";
import { TableSkeleton } from "../../components/common/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { ticketService } from "../../services/ticketService";
import type { Ticket, TicketStatus } from "../../types/api";

export function AssignedTicketsPage() {
	const { user } = useAuth();
	const navigate = useNavigate();

	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	useEffect(() => {
		async function fetchAssigned() {
			try {
				setLoading(true);
				const statusParam =
					statusFilter === "all" ? undefined : [statusFilter as TicketStatus];
				const res = await ticketService.listTickets({
					callerRole: "assignee",
					callerId: user?.id,
					status: statusParam,
					q: searchQuery.trim() || undefined,
					sortBy: "priority",
					order: "desc",
				});
				setTickets(res.items);
			} catch (err) {
				console.error("Failed to load assigned tickets", err);
			} finally {
				setLoading(false);
			}
		}

		fetchAssigned();
	}, [user?.id, statusFilter, searchQuery]);

	const inProgressCount = tickets.filter(
		(t) => t.status === "in_progress",
	).length;
	const criticalCount = tickets.filter(
		(t) => t.priority === "critical" && t.status !== "closed",
	).length;

	return (
		<div className="page-wrapper">
			<div className="page-header">
				<div>
					<h2 className="page-title">Assigned Work Queue</h2>
					<p className="page-description">
						Manage active service dispatches assigned to you, report work in
						progress, and submit completion proof.
					</p>
				</div>
			</div>

			{/* KPI Metric Cards */}
			<div className="stats-grid">
				<div className="stat-card">
					<div className="stat-icon-wrap bg-indigo-subtle text-indigo">
						<CheckSquare size={20} />
					</div>
					<div className="stat-content">
						<span className="stat-label">Assigned to You</span>
						<span className="stat-value">{tickets.length}</span>
					</div>
				</div>

				<div className="stat-card">
					<div className="stat-icon-wrap bg-amber-subtle text-amber">
						<Layers size={20} />
					</div>
					<div className="stat-content">
						<span className="stat-label">Currently In Progress</span>
						<span className="stat-value">{inProgressCount}</span>
					</div>
				</div>

				<div className="stat-card">
					<div className="stat-icon-wrap bg-red-subtle text-danger">
						<AlertTriangle size={20} />
					</div>
					<div className="stat-content">
						<span className="stat-label">Critical Priority</span>
						<span className="stat-value">{criticalCount}</span>
					</div>
				</div>
			</div>

			{/* Filter Toolbar */}
			<div className="filter-toolbar">
				<div className="search-box">
					<Input
						placeholder="Search assigned tickets by title or location..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						leftIcon={<Search size={16} />}
						className="input-sm"
					/>
				</div>

				<div className="filter-controls">
					<div className="filter-select-wrap">
						<Select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value)}
							className="select-sm"
						>
							<option value="all">All Assigned Statuses</option>
							<option value="assigned">Assigned (Not Started)</option>
							<option value="in_progress">In Progress</option>
							<option value="resolved">Resolved</option>
						</Select>
					</div>
				</div>
			</div>

			{/* Data Table */}
			<div className="card table-card">
				{loading ? (
					<TableSkeleton rows={4} cols={6} />
				) : tickets.length === 0 ? (
					<EmptyState
						title="No assigned tickets"
						description="You currently have no pending service dispatches in this view."
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
									<th>Ticket Age</th>
									<th className="text-right">Action</th>
								</tr>
							</thead>
							<tbody>
								{tickets.map((t) => {
									const hoursAgo = Math.round(
										(Date.now() - new Date(t.createdAt).getTime()) /
											(1000 * 60 * 60),
									);

									return (
										<tr
											key={t.id}
											className="clickable-row"
											onClick={() => navigate(`/assignee/tickets/${t.id}`)}
										>
											<td>
												<div className="ticket-title-cell">
													<span className="ticket-id-tag">#{t.id}</span>
													<span className="ticket-title-text font-medium">
														{t.title}
													</span>
												</div>
											</td>
											<td className="text-secondary">{t.location}</td>
											<td>
												<PriorityBadge priority={t.priority} size="sm" />
											</td>
											<td>
												<StatusBadge status={t.status} size="sm" />
											</td>
											<td className="text-secondary text-sm">
												<span className="flex items-center gap-1">
													<Clock size={13} />
													<span>{hoursAgo}h ago</span>
												</span>
											</td>
											<td className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={(e) => {
														e.stopPropagation();
														navigate(`/assignee/tickets/${t.id}`);
													}}
												>
													Open Workspace
												</Button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
