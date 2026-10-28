import { PlusCircle, RotateCcw, Search } from "lucide-react";
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
import type { Ticket, TicketPriority, TicketStatus } from "../../types/api";

export function MyTicketsPage() {
	const { user } = useAuth();
	const navigate = useNavigate();

	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);

	// Filters
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [priorityFilter, setPriorityFilter] = useState<string>("all");
	const [sortBy, setSortBy] = useState<"createdAt" | "priority">("createdAt");
	const [order, setOrder] = useState<"asc" | "desc">("desc");
	const [page, setPage] = useState(1);
	const limit = 8;

	useEffect(() => {
		async function fetchTickets() {
			try {
				setLoading(true);
				const statusParam =
					statusFilter === "all" ? undefined : [statusFilter as TicketStatus];
				const priorityParam =
					priorityFilter === "all"
						? undefined
						: [priorityFilter as TicketPriority];

				const res = await ticketService.listTickets({
					callerRole: "requester",
					callerId: user?.id,
					q: searchQuery.trim() || undefined,
					status: statusParam,
					priority: priorityParam,
					sortBy,
					order,
					limit,
					offset: (page - 1) * limit,
				});

				setTickets(res.items);
				setTotal(res.total);
			} catch (err) {
				console.error("Failed to fetch tickets", err);
			} finally {
				setLoading(false);
			}
		}

		fetchTickets();
	}, [
		user?.id,
		searchQuery,
		statusFilter,
		priorityFilter,
		sortBy,
		order,
		page,
	]);

	const resetFilters = () => {
		setSearchQuery("");
		setStatusFilter("all");
		setPriorityFilter("all");
		setSortBy("createdAt");
		setOrder("desc");
		setPage(1);
	};

	const totalPages = Math.ceil(total / limit) || 1;

	return (
		<div className="page-wrapper">
			<div className="page-header">
				<div>
					<h2 className="page-title">My Tickets</h2>
					<p className="page-description">
						Search, filter, and track status updates on all tickets you have
						submitted.
					</p>
				</div>
				<Button
					variant="primary"
					icon={<PlusCircle size={16} />}
					onClick={() => navigate("/requester/tickets/new")}
				>
					Create Ticket
				</Button>
			</div>

			{/* Filters & Search Toolbar */}
			<div className="filter-toolbar">
				<div className="search-box">
					<Input
						placeholder="Search by title, location, or #ID..."
						value={searchQuery}
						onChange={(e) => {
							setSearchQuery(e.target.value);
							setPage(1);
						}}
						leftIcon={<Search size={16} />}
						className="input-sm"
					/>
				</div>

				<div className="filter-controls">
					<div className="filter-select-wrap">
						<Select
							value={statusFilter}
							onChange={(e) => {
								setStatusFilter(e.target.value);
								setPage(1);
							}}
							className="select-sm"
						>
							<option value="all">All Statuses</option>
							<option value="open">Open</option>
							<option value="assigned">Assigned</option>
							<option value="in_progress">In Progress</option>
							<option value="resolved">Resolved</option>
							<option value="closed">Closed</option>
						</Select>
					</div>

					<div className="filter-select-wrap">
						<Select
							value={priorityFilter}
							onChange={(e) => {
								setPriorityFilter(e.target.value);
								setPage(1);
							}}
							className="select-sm"
						>
							<option value="all">All Priorities</option>
							<option value="critical">Critical</option>
							<option value="high">High</option>
							<option value="medium">Medium</option>
							<option value="low">Low</option>
						</Select>
					</div>

					<div className="filter-select-wrap">
						<Select
							value={`${sortBy}_${order}`}
							onChange={(e) => {
								const [field, ord] = e.target.value.split("_");
								setSortBy(field as "createdAt" | "priority");
								setOrder(ord as "asc" | "desc");
							}}
							className="select-sm"
						>
							<option value="createdAt_desc">Newest First</option>
							<option value="createdAt_asc">Oldest First</option>
							<option value="priority_desc">Highest Priority</option>
						</Select>
					</div>

					{(searchQuery ||
						statusFilter !== "all" ||
						priorityFilter !== "all") && (
						<Button
							variant="ghost"
							size="sm"
							icon={<RotateCcw size={14} />}
							onClick={resetFilters}
							title="Reset all filters"
						>
							Reset
						</Button>
					)}
				</div>
			</div>

			{/* Main Data Table */}
			<div className="card table-card">
				{loading ? (
					<TableSkeleton rows={5} cols={6} />
				) : tickets.length === 0 ? (
					<EmptyState
						title="No matching tickets found"
						description="Try adjusting your keyword search or filter criteria to find what you're looking for."
						action={
							<Button variant="secondary" size="sm" onClick={resetFilters}>
								Clear Filters
							</Button>
						}
					/>
				) : (
					<>
						<div className="table-responsive">
							<table className="data-table">
								<thead>
									<tr>
										<th>Ticket</th>
										<th>Location</th>
										<th>Priority</th>
										<th>Status</th>
										<th>Date Submitted</th>
										<th className="text-right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{tickets.map((t) => (
										<tr
											key={t.id}
											className="clickable-row"
											onClick={() => navigate(`/requester/tickets/${t.id}`)}
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
												{new Date(t.createdAt).toLocaleDateString(undefined, {
													month: "short",
													day: "numeric",
													year: "numeric",
												})}
											</td>
											<td className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={(e) => {
														e.stopPropagation();
														navigate(`/requester/tickets/${t.id}`);
													}}
												>
													Details
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						{/* Pagination Controls */}
						<div className="table-pagination">
							<span className="pagination-info">
								Showing <strong>{(page - 1) * limit + 1}</strong> to{" "}
								<strong>{Math.min(page * limit, total)}</strong> of{" "}
								<strong>{total}</strong> tickets
							</span>

							<div className="pagination-buttons">
								<Button
									variant="secondary"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
								>
									Previous
								</Button>
								<span className="pagination-current-page">
									Page {page} of {totalPages}
								</span>
								<Button
									variant="secondary"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								>
									Next
								</Button>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
