import { Inbox, RotateCcw, Search, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PriorityBadge, StatusBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { Input } from "../../components/common/Input";
import { Modal } from "../../components/common/Modal";
import { Select } from "../../components/common/Select";
import { TableSkeleton } from "../../components/common/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ticketService } from "../../services/ticketService";
import type {
	Person,
	Ticket,
	TicketPriority,
	TicketStatusFilter,
} from "../../types/api";

export function SupervisorQueuePage() {
	const { user } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();

	const [tickets, setTickets] = useState<Ticket[]>([]);
	const [techs, setTechs] = useState<Person[]>([]);
	const [loading, setLoading] = useState(true);

	// Filter state
	const initialStatus = searchParams.get("status") || "all";
	const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
	const [priorityFilter, setPriorityFilter] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");

	// Dispatch modal
	const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
	const [targetTicket, setTargetTicket] = useState<Ticket | null>(null);
	const [selectedTechId, setSelectedTechId] = useState("");
	const [dispatching, setDispatching] = useState(false);

	const loadQueue = useCallback(async () => {
		try {
			setLoading(true);
			const [ticketRes, people] = await Promise.all([
				ticketService.listTickets({
					status:
						statusFilter === "all"
							? undefined
							: [statusFilter as TicketStatusFilter],
					priority:
						priorityFilter === "all"
							? undefined
							: [priorityFilter as TicketPriority],
					q: searchQuery.trim() || undefined,
					sortBy: "priority",
					order: "desc",
					limit: 50,
				}),
				ticketService.listPeople(),
			]);

			setTickets(ticketRes.items);
			setTechs(people.filter((p) => p.role === "assignee"));
		} catch (err) {
			console.error("Failed to load queue", err);
		} finally {
			setLoading(false);
		}
	}, [statusFilter, priorityFilter, searchQuery]);

	useEffect(() => {
		loadQueue();
	}, [loadQueue]);

	const handleOpenDispatch = (ticket: Ticket) => {
		setTargetTicket(ticket);
		setSelectedTechId("");
		setDispatchModalOpen(true);
	};

	const handleConfirmDispatch = async () => {
		if (!targetTicket || !selectedTechId) return;

		try {
			setDispatching(true);
			await ticketService.assignTicket(
				targetTicket.id,
				selectedTechId,
				user?.id || "p-sup-1",
			);
			showToast(
				`Dispatched technician to ticket #${targetTicket.id}`,
				"success",
			);
			setDispatchModalOpen(false);
			loadQueue();
		} catch (_err) {
			showToast("Failed to assign technician", "error");
		} finally {
			setDispatching(false);
		}
	};

	return (
		<div className="page-wrapper">
			<div className="page-header">
				<div>
					<h2 className="page-title">Department Triage Queue</h2>
					<p className="page-description">
						Assign incoming tickets to specialized technicians and monitor queue
						SLA.
					</p>
				</div>
			</div>

			{/* Filter Controls */}
			<div className="filter-toolbar">
				<div className="search-box">
					<Input
						placeholder="Search by title, location, ID..."
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
							<option value="all">All Statuses</option>
							<option value="open">Open (Unassigned)</option>
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
							onChange={(e) => setPriorityFilter(e.target.value)}
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
							}}
						>
							Reset
						</Button>
					)}
				</div>
			</div>

			{/* Queue Table */}
			<div className="card table-card">
				{loading ? (
					<TableSkeleton rows={6} cols={6} />
				) : tickets.length === 0 ? (
					<EmptyState
						icon={<Inbox size={32} />}
						title="Queue is empty"
						description="No tickets match the selected triage criteria."
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
									<th>Date</th>
									<th className="text-right">Dispatch & Actions</th>
								</tr>
							</thead>
							<tbody>
								{tickets.map((t) => (
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
										<td className="text-secondary">{t.location}</td>
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
											})}
										</td>
										<td className="text-right">
											<div className="table-row-actions">
												{t.status === "open" ? (
													<Button
														variant="primary"
														size="sm"
														icon={<UserPlus size={13} />}
														onClick={(e) => {
															e.stopPropagation();
															handleOpenDispatch(t);
														}}
													>
														Dispatch
													</Button>
												) : (
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
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Dispatch Modal */}
			<Modal
				isOpen={dispatchModalOpen}
				onClose={() => setDispatchModalOpen(false)}
				title="Assign Field Technician"
				description={`Select a technician to assign to #${targetTicket?.id}: "${targetTicket?.title}"`}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button
							variant="secondary"
							onClick={() => setDispatchModalOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							isLoading={dispatching}
							disabled={!selectedTechId}
							onClick={handleConfirmDispatch}
						>
							Confirm Dispatch
						</Button>
					</div>
				}
			>
				<Select
					id="queue-tech-select"
					label="Select Available Technician"
					value={selectedTechId}
					onChange={(e) => setSelectedTechId(e.target.value)}
					required
				>
					<option value="">-- Choose Field Tech --</option>
					{techs.map((tech) => (
						<option key={tech.id} value={tech.id}>
							{tech.name} ({tech.email})
						</option>
					))}
				</Select>
			</Modal>
		</div>
	);
}
