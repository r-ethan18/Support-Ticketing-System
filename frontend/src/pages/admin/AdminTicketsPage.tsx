import { Compass, Download, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PriorityBadge, StatusBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { Input } from "../../components/common/Input";
import { Select } from "../../components/common/Select";
import { TableSkeleton } from "../../components/common/Skeleton";
import { useToast } from "../../context/ToastContext";
import { ticketService } from "../../services/ticketService";
import type {
	Person,
	Ticket,
	TicketPriority,
	TicketStatusFilter,
} from "../../types/api";

export function AdminTicketsPage() {
	const navigate = useNavigate();
	const { showToast } = useToast();

	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [people, setPeople] = useState<Person[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);

	// Filters
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [priorityFilter, setPriorityFilter] = useState<string>("all");
	const [page, setPage] = useState(1);
	const limit = 10;

	useEffect(() => {
		async function fetchAll() {
			try {
				setLoading(true);
				const statusParam =
					statusFilter === "all"
						? undefined
						: [statusFilter as TicketStatusFilter];
				const priorityParam =
					priorityFilter === "all"
						? undefined
						: [priorityFilter as TicketPriority];

				const [ticketRes, peopleRes] = await Promise.all([
					ticketService.listTickets({
						q: searchQuery.trim() || undefined,
						status: statusParam,
						priority: priorityParam,
						limit,
						offset: (page - 1) * limit,
						sortBy: "createdAt",
						order: "desc",
					}),
					ticketService.listPeople(),
				]);

				setTickets(ticketRes.items);
				setTotal(ticketRes.total);
				setPeople(peopleRes);
			} catch (err) {
				console.error("Failed to load global tickets", err);
			} finally {
				setLoading(false);
			}
		}

		fetchAll();
	}, [searchQuery, statusFilter, priorityFilter, page]);

	const totalPages = Math.ceil(total / limit) || 1;

	const handleExport = () => {
		if (tickets.length === 0) {
			showToast("No tickets available to export", "info");
			return;
		}
		const headers = [
			"ID",
			"Title",
			"Location",
			"Priority",
			"Status",
			"Created At",
			"Closed At",
		];
		const rows = tickets.map((t) => [
			t.id,
			`"${t.title.replace(/"/g, '""')}"`,
			`"${t.location.replace(/"/g, '""')}"`,
			t.priority,
			t.status,
			t.createdAt,
			t.closedAt || "",
		]);
		const csvContent = [
			headers.join(","),
			...rows.map((r) => r.join(",")),
		].join("\n");
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.setAttribute("href", url);
		link.setAttribute("download", `sts-tickets-audit-${Date.now()}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
		showToast(
			`Exported ${tickets.length} tickets to CSV audit file`,
			"success",
		);
	};

	return (
		<div className="page-wrapper">
			<div className="page-header">
				<div>
					<h2 className="page-title">Global Ticket Database</h2>
					<p className="page-description">
						Complete enterprise-wide registry of all submitted incidents,
						dispatch assignments, and resolution audits.
					</p>
				</div>
				<Button
					variant="secondary"
					icon={<Download size={15} />}
					onClick={handleExport}
				>
					Export Audit CSV
				</Button>
			</div>

			{/* Filter Toolbar */}
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
							<option value="reopen_requested">Reopen Requested</option>
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

					{(searchQuery ||
						statusFilter !== "all" ||
						priorityFilter !== "all") && (
						<Button
							variant="ghost"
							size="sm"
							icon={<RotateCcw size={14} />}
							onClick={() => {
								setSearchQuery("");
								setStatusFilter("all");
								setPriorityFilter("all");
								setPage(1);
							}}
						>
							Reset
						</Button>
					)}
				</div>
			</div>

			{/* Table Card */}
			<div className="card table-card">
				{loading ? (
					<TableSkeleton rows={6} cols={6} />
				) : tickets.length === 0 ? (
					<EmptyState
						icon={<Compass size={32} />}
						title="No matching records"
						description="No tickets found matching the specified search criteria."
					/>
				) : (
					<>
						<div className="table-responsive">
							<table className="data-table">
								<thead>
									<tr>
										<th>Ticket</th>
										<th>Requester</th>
										<th>Location</th>
										<th>Priority</th>
										<th>Status</th>
										<th>Date</th>
										<th className="text-right">Actions</th>
									</tr>
								</thead>
								<tbody>
									{tickets.map((t) => {
										const requester = people.find(
											(p) => p.id === t.requesterId,
										);
										return (
											<tr
												key={t.id}
												className="clickable-row"
												onClick={() => navigate(`/admin/tickets/${t.id}`)}
											>
												<td>
													<div className="ticket-title-cell">
														<span className="ticket-id-tag">#{t.id}</span>
														<span className="ticket-title-text font-medium">
															{t.title}
														</span>
													</div>
												</td>
												<td className="text-slate text-sm">
													{requester?.name || "Employee"}
												</td>
												<td className="text-secondary text-sm">{t.location}</td>
												<td>
													<PriorityBadge priority={t.priority} size="sm" />
												</td>
												<td>
													<StatusBadge
														status={t.status}
														reopenRequested={t.reopenRequested}
														size="sm"
													/>
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
															navigate(`/admin/tickets/${t.id}`);
														}}
													>
														Manage
													</Button>
												</td>
											</tr>
										);
									})}
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
