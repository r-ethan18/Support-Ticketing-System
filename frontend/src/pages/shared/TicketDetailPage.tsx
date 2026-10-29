import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	Clock,
	FileText,
	History,
	Image as ImageIcon,
	MapPin,
	MessageSquare,
	Paperclip,
	Send,
	ShieldAlert,
	UploadCloud,
	UserPlus,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../../components/common/Avatar";
import { PriorityBadge, StatusBadge } from "../../components/common/Badge";
import { Button } from "../../components/common/Button";
import { EmptyState } from "../../components/common/EmptyState";
import { Input } from "../../components/common/Input";
import { Modal } from "../../components/common/Modal";
import { Select } from "../../components/common/Select";
import { Skeleton } from "../../components/common/Skeleton";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useTicketStream } from "../../hooks/useTicketStream";
import { isMockMode, ticketService } from "../../services/ticketService";
import type {
	Asset,
	AttachmentKind,
	Person,
	Ticket,
	TicketAssignment,
	TicketAttachment,
	TicketComment,
	TicketStatus,
	TicketStatusHistoryEntry,
} from "../../types/api";

export function TicketDetailPage() {
	const { id } = useParams<{ id: string }>();
	const { user, role } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();

	const [ticket, setTicket] = useState<Ticket | null>(null);
	const [comments, setComments] = useState<TicketComment[]>([]);
	const [assignments, setAssignments] = useState<TicketAssignment[]>([]);
	const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
	const [history, setHistory] = useState<TicketStatusHistoryEntry[]>([]);
	const [people, setPeople] = useState<Person[]>([]);
	const [assets, setAssets] = useState<Asset[]>([]);

	const [activeTab, setActiveTab] = useState<
		"conversation" | "attachments" | "history"
	>("conversation");
	const [commentBody, setCommentBody] = useState("");
	const [submittingComment, setSubmittingComment] = useState(false);
	const [loading, setLoading] = useState(true);

	// Assignment modal
	const [assignModalOpen, setAssignModalOpen] = useState(false);
	const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
	const [assigning, setAssigning] = useState(false);

	// Attachment modal
	const [attachModalOpen, setAttachModalOpen] = useState(false);
	const [attachUrl, setAttachUrl] = useState("");
	const [attachKind, setAttachKind] =
		useState<AttachmentKind>("issue_evidence");
	const [attaching, setAttaching] = useState(false);

	// Status update state
	const [updatingStatus, setUpdatingStatus] = useState(false);
	// Whether we have a live SSE connection (live-backend mode only).
	const [isLive, setIsLive] = useState(false);

	// Real-time SSE callbacks ---------------------------------------------------
	const handleStreamComment = useCallback((newComment: TicketComment) => {
		setIsLive(true);
		setComments((prev) => {
			// Deduplicate: the local optimistic update already added this comment
			// if the current user posted it, so skip duplicates by id.
			if (prev.some((c) => c.id === newComment.id)) return prev;
			return [...prev, newComment];
		});
	}, []);

	const handleStreamStatus = useCallback(
		(ticketId: string, status: TicketStatus, _changedAt: string) => {
			setIsLive(true);
			setTicket((prev) =>
				prev && prev.id === ticketId ? { ...prev, status } : prev,
			);
		},
		[],
	);

	useTicketStream(id, {
		onComment: handleStreamComment,
		onStatus: handleStreamStatus,
	});

	// Mark as live once the SSE hook connects in live mode.
	useEffect(() => {
		if (!isMockMode()) setIsLive(true);
	}, []);

	useEffect(() => {
		async function loadTicketData() {
			if (!id) return;
			try {
				setLoading(true);
				const [
					loadedTicket,
					loadedComments,
					loadedAssignments,
					loadedAttachments,
					loadedHistory,
					loadedPeople,
					loadedAssets,
				] = await Promise.all([
					ticketService.getTicket(id),
					ticketService.listComments(id),
					ticketService.listAssignments(id),
					ticketService.listAttachments(id),
					ticketService.listStatusHistory(id),
					ticketService.listPeople(),
					ticketService.listAssets(),
				]);

				setTicket(loadedTicket);
				setComments(loadedComments);
				setAssignments(loadedAssignments);
				setAttachments(loadedAttachments);
				setHistory(loadedHistory);
				setPeople(loadedPeople);
				setAssets(loadedAssets);
			} catch (err) {
				console.error("Failed to load ticket details", err);
				showToast("Failed to load ticket details", "error");
			} finally {
				setLoading(false);
			}
		}

		loadTicketData();
	}, [id, showToast]);

	if (loading) {
		return (
			<div className="page-wrapper max-w-6xl">
				<div className="flex gap-4 mb-4">
					<Skeleton height={24} width={120} />
				</div>
				<Skeleton height={80} className="mb-4" />
				<div className="grid grid-cols-3 gap-6">
					<div className="col-span-2">
						<Skeleton height={400} />
					</div>
					<div>
						<Skeleton height={400} />
					</div>
				</div>
			</div>
		);
	}

	if (!ticket) {
		return (
			<div className="page-wrapper max-w-4xl text-center py-12">
				<EmptyState
					icon={<ShieldAlert size={40} className="text-danger" />}
					title="Ticket Not Found"
					description={`Could not locate ticket with identifier #${id}.`}
					action={
						<Button
							variant="secondary"
							onClick={() => navigate(`/${role}/tickets`)}
						>
							Return to Tickets
						</Button>
					}
				/>
			</div>
		);
	}

	// Resolve relationships
	const requester = people.find((p) => p.id === ticket.requesterId);
	const activeAssignment = assignments.find((a) => !a.unassignedAt);
	const currentAssignee = activeAssignment
		? people.find((p) => p.id === activeAssignment.assigneeId)
		: null;
	const asset = assets.find((a) => a.id === ticket.assetId);
	const assignableTechs = people.filter((p) => p.role === "assignee");

	const handlePostComment = async (e: FormEvent) => {
		e.preventDefault();
		if (!commentBody.trim()) return;

		try {
			setSubmittingComment(true);
			const newC = await ticketService.createComment(
				ticket.id,
				commentBody.trim(),
				user?.id || "p-req-1",
			);
			setComments((prev) => [...prev, newC]);
			setCommentBody("");
			showToast("Comment posted to conversation", "success");
		} catch (_err) {
			showToast("Failed to post comment", "error");
		} finally {
			setSubmittingComment(false);
		}
	};

	const handleUpdateStatus = async (newStatus: TicketStatus) => {
		try {
			setUpdatingStatus(true);
			const updated = await ticketService.updateTicket(
				ticket.id,
				{ status: newStatus },
				user?.id || "p-user-1",
			);
			setTicket(updated);
			// In mock mode refresh history manually; in live mode SSE pushes the update.
			if (isMockMode()) {
				const freshHistory = await ticketService.listStatusHistory(ticket.id);
				setHistory(freshHistory);
			}
			showToast(`Status updated to ${newStatus.toUpperCase()}`, "success");
		} catch (_err) {
			showToast("Failed to update status", "error");
		} finally {
			setUpdatingStatus(false);
		}
	};

	const handleAssignSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!selectedAssigneeId) return;

		try {
			setAssigning(true);
			const newAsg = await ticketService.assignTicket(
				ticket.id,
				selectedAssigneeId,
				user?.id || "p-sup-1",
			);
			setAssignments((prev) => [...prev, newAsg]);
			setTicket((prev) =>
				prev ? { ...prev, status: "assigned", supervisorId: user?.id } : prev,
			);
			setAssignModalOpen(false);
			showToast("Technician assigned to ticket", "success");
		} catch (_err) {
			showToast("Failed to assign ticket", "error");
		} finally {
			setAssigning(false);
		}
	};

	const handleAddAttachment = async (e: FormEvent) => {
		e.preventDefault();
		if (!attachUrl.trim()) return;

		try {
			setAttaching(true);
			const newAtt = await ticketService.addAttachment(
				ticket.id,
				attachKind,
				attachUrl.trim(),
				user?.id || "p-user-1",
			);
			setAttachments((prev) => [...prev, newAtt]);
			setAttachUrl("");
			setAttachModalOpen(false);
			showToast("Attachment uploaded successfully", "success");
		} catch (_err) {
			showToast("Failed to add attachment", "error");
		} finally {
			setAttaching(false);
		}
	};

	const backUrl =
		role === "requester"
			? "/requester/tickets"
			: role === "assignee"
				? "/assignee/tickets"
				: role === "supervisor"
					? "/supervisor/queue"
					: "/admin/tickets";

	return (
		<div className="page-wrapper max-w-6xl">
			{/* Breadcrumb Navigation */}
			<div className="breadcrumb-nav mb-4">
				<button
					type="button"
					className="back-btn"
					onClick={() => navigate(backUrl)}
				>
					<ArrowLeft size={16} />
					<span>Back to Queue</span>
				</button>
			</div>

			{/* Ticket Header Banner */}
			<div className="ticket-detail-header-card">
				<div className="ticket-header-top">
					<div className="ticket-id-badge-wrap">
						<span className="ticket-large-id">#{ticket.id}</span>
						<StatusBadge status={ticket.status} size="md" />
						<PriorityBadge priority={ticket.priority} size="md" />
					</div>
					<div className="ticket-header-timestamps">
						<span className="timestamp-item">
							<Clock size={14} />
							<span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
						</span>
						{ticket.closedAt && (
							<span className="timestamp-item text-emerald">
								<CheckCircle size={14} />
								<span>Closed {new Date(ticket.closedAt).toLocaleString()}</span>
							</span>
						)}
					</div>
				</div>

				<h2 className="ticket-detail-title">{ticket.title}</h2>

				<div className="ticket-header-meta">
					<div className="meta-badge-item">
						<MapPin size={15} className="text-secondary" />
						<span>{ticket.location}</span>
					</div>
					{asset && (
						<div className="meta-badge-item">
							<FileText size={15} className="text-secondary" />
							<span>Asset: {asset.name}</span>
						</div>
					)}
				</div>
			</div>

			{/* Main Split Layout */}
			<div className="ticket-workspace-grid">
				{/* Left Panel: Conversation, Attachments, Audit */}
				<div className="workspace-main-panel">
					{/* Description Box */}
					<div className="card description-card mb-4">
						<h3 className="card-section-title">Issue Description</h3>
						<p className="ticket-description-text">{ticket.description}</p>
					</div>

					{/* Workspace Navigation Tabs */}
					<div className="workspace-tabs-card">
						<div className="tab-header">
							<button
								type="button"
								className={`tab-btn ${activeTab === "conversation" ? "active" : ""}`}
								onClick={() => setActiveTab("conversation")}
							>
								<MessageSquare size={16} />
								<span>Conversation ({comments.length})</span>
								{isLive && (
									<span
										className="sse-live-badge"
										title="Real-time updates active"
									>
										<span className="sse-live-dot" />
										LIVE
									</span>
								)}
							</button>
							<button
								type="button"
								className={`tab-btn ${activeTab === "attachments" ? "active" : ""}`}
								onClick={() => setActiveTab("attachments")}
							>
								<Paperclip size={16} />
								<span>Attachments ({attachments.length})</span>
							</button>
							<button
								type="button"
								className={`tab-btn ${activeTab === "history" ? "active" : ""}`}
								onClick={() => setActiveTab("history")}
							>
								<History size={16} />
								<span>Audit Trail ({history.length})</span>
							</button>
						</div>

						{/* Tab 1: Conversation & Comments */}
						{activeTab === "conversation" && (
							<div className="tab-body">
								<div className="comments-stream">
									{comments.length === 0 ? (
										<EmptyState
											icon={<MessageSquare size={28} />}
											title="No comments yet"
											description="Start the conversation between requester, field technician, and supervisor."
										/>
									) : (
										comments.map((comment) => {
											const author = people.find(
												(p) => p.id === comment.authorId,
											);
											const isMe = comment.authorId === user?.id;

											return (
												<div
													key={comment.id}
													className={`comment-bubble-wrap ${isMe ? "mine" : ""}`}
												>
													<Avatar
														name={author?.name || "User"}
														size="sm"
														className="comment-avatar"
													/>
													<div className="comment-content-box">
														<div className="comment-meta">
															<span className="author-name">
																{author?.name || "Support Member"}
															</span>
															{author?.role && (
																<span className="author-role-tag">
																	{author.role}
																</span>
															)}
															<span className="comment-time">
																{new Date(comment.createdAt).toLocaleTimeString(
																	[],
																	{
																		hour: "2-digit",
																		minute: "2-digit",
																		month: "short",
																		day: "numeric",
																	},
																)}
															</span>
														</div>
														<p className="comment-body">{comment.body}</p>
													</div>
												</div>
											);
										})
									)}
								</div>

								{/* Comment Composer */}
								<form onSubmit={handlePostComment} className="comment-composer">
									<textarea
										rows={3}
										className="form-textarea composer-input"
										placeholder="Post an update, status report, or clarification to this ticket..."
										value={commentBody}
										onChange={(e) => setCommentBody(e.target.value)}
										required
									/>
									<div className="composer-footer">
										<span className="text-muted text-xs">
											Visible to all assigned parties and department
											supervisors.
										</span>
										<Button
											type="submit"
											variant="primary"
											size="sm"
											isLoading={submittingComment}
											icon={<Send size={14} />}
										>
											Send Reply
										</Button>
									</div>
								</form>
							</div>
						)}

						{/* Tab 2: Attachments & Evidence */}
						{activeTab === "attachments" && (
							<div className="tab-body">
								<div className="attachments-header mb-4">
									<span className="text-sm text-secondary">
										Documentary evidence and proof of completion files.
									</span>
									<Button
										variant="outline"
										size="sm"
										icon={<UploadCloud size={14} />}
										onClick={() => setAttachModalOpen(true)}
									>
										Add Attachment
									</Button>
								</div>

								{attachments.length === 0 ? (
									<EmptyState
										icon={<ImageIcon size={28} />}
										title="No files attached"
										description="Upload equipment photos or repair completion receipts."
										action={
											<Button
												variant="secondary"
												size="sm"
												onClick={() => setAttachModalOpen(true)}
											>
												Upload Attachment
											</Button>
										}
									/>
								) : (
									<div className="attachments-grid">
										{attachments.map((att) => {
											const uploader = people.find(
												(p) => p.id === att.uploadedById,
											);
											return (
												<div key={att.id} className="attachment-card">
													<div className="attachment-preview">
														<img
															src={att.storageUrl}
															alt="Ticket attachment"
															onError={(e) => {
																(e.target as HTMLImageElement).src =
																	"https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&q=80";
															}}
														/>
														<span
															className={`attachment-kind-badge ${att.kind}`}
														>
															{att.kind === "issue_evidence"
																? "Evidence"
																: "Completion Proof"}
														</span>
													</div>
													<div className="attachment-info">
														<span className="attachment-uploader">
															By {uploader?.name || "Technician"}
														</span>
														<span className="attachment-date">
															{new Date(att.uploadedAt).toLocaleDateString()}
														</span>
													</div>
												</div>
											);
										})}
									</div>
								)}
							</div>
						)}

						{/* Tab 3: Audit Trail / Status History */}
						{activeTab === "history" && (
							<div className="tab-body">
								{history.length === 0 ? (
									<EmptyState
										icon={<History size={28} />}
										title="No status changes recorded"
										description="Status changes and reassignments will be audited here."
									/>
								) : (
									<div className="history-timeline">
										{history.map((item) => {
											const changer = people.find(
												(p) => p.id === item.changedById,
											);
											return (
												<div key={item.id} className="timeline-item">
													<div className="timeline-dot" />
													<div className="timeline-content">
														<div className="timeline-title">
															<span>Status updated to </span>
															<StatusBadge status={item.toStatus} size="sm" />
															{item.fromStatus && (
																<span className="text-muted text-xs ml-2">
																	(from {item.fromStatus})
																</span>
															)}
														</div>
														<div className="timeline-meta">
															<span>By {changer?.name || "System"}</span>
															<span>•</span>
															<span>
																{new Date(item.changedAt).toLocaleString()}
															</span>
														</div>
													</div>
												</div>
											);
										})}
									</div>
								)}
							</div>
						)}
					</div>
				</div>

				{/* Right Panel: Incident Metadata & Actions */}
				<div className="workspace-side-panel">
					{/* Status Workflow Action Card */}
					<div className="card control-card mb-4">
						<h3 className="card-section-title">Workflow Actions</h3>
						<div className="workflow-status-controls">
							{/* Requester Actions */}
							{role === "requester" && (
								<>
									{ticket.status !== "closed" && (
										<Button
											variant="outline"
											className="w-full text-danger"
											isLoading={updatingStatus}
											onClick={() => handleUpdateStatus("closed")}
										>
											Close Ticket (Issue Resolved)
										</Button>
									)}
									{ticket.status === "closed" && (
										<Button
											variant="primary"
											className="w-full"
											isLoading={updatingStatus}
											onClick={() => handleUpdateStatus("open")}
										>
											Reopen Incident
										</Button>
									)}
								</>
							)}

							{/* Assignee Actions */}
							{role === "assignee" && (
								<div className="flex flex-col gap-2">
									{ticket.status === "assigned" && (
										<Button
											variant="primary"
											className="w-full"
											isLoading={updatingStatus}
											onClick={() => handleUpdateStatus("in_progress")}
										>
											Start Work (In Progress)
										</Button>
									)}
									{ticket.status === "in_progress" && (
										<Button
											variant="primary"
											className="w-full bg-emerald"
											isLoading={updatingStatus}
											onClick={() => handleUpdateStatus("resolved")}
										>
											Mark as Resolved
										</Button>
									)}
									{ticket.status === "resolved" && (
										<span className="text-center text-xs text-emerald py-2">
											✓ Resolution logged. Pending requester close.
										</span>
									)}
								</div>
							)}

							{/* Supervisor & Admin Actions */}
							{(role === "supervisor" || role === "admin") && (
								<div className="flex flex-col gap-2">
									<label
										htmlFor="change-status-select"
										className="text-xs font-semibold text-muted"
									>
										OVERRIDE STATUS
									</label>
									<Select
										id="change-status-select"
										value={ticket.status}
										onChange={(e) =>
											handleUpdateStatus(e.target.value as TicketStatus)
										}
										disabled={updatingStatus}
										className="select-sm"
									>
										<option value="open">Open</option>
										<option value="assigned">Assigned</option>
										<option value="in_progress">In Progress</option>
										<option value="resolved">Resolved</option>
										<option value="closed">Closed</option>
									</Select>
								</div>
							)}
						</div>
					</div>

					{/* Assignment Card */}
					<div className="card control-card mb-4">
						<div className="card-section-header">
							<h3 className="card-section-title">Assigned Field Tech</h3>
							{(role === "supervisor" || role === "admin") && (
								<Button
									variant="ghost"
									size="sm"
									icon={<UserPlus size={14} />}
									onClick={() => setAssignModalOpen(true)}
								>
									{currentAssignee ? "Reassign" : "Assign"}
								</Button>
							)}
						</div>

						{currentAssignee ? (
							<div className="assigned-person-box">
								<Avatar name={currentAssignee.name} size="md" />
								<div className="person-details">
									<span className="person-name">{currentAssignee.name}</span>
									<span className="person-email">{currentAssignee.email}</span>
									<span className="person-phone">{currentAssignee.phone}</span>
								</div>
							</div>
						) : (
							<div className="unassigned-notice">
								<AlertTriangle size={16} className="text-amber" />
								<span className="text-sm text-secondary">
									No assignee dispatched yet.
								</span>
							</div>
						)}
					</div>

					{/* Requester Profile Card */}
					<div className="card control-card mb-4">
						<h3 className="card-section-title">Submitted By</h3>
						{requester ? (
							<div className="assigned-person-box">
								<Avatar name={requester.name} size="md" />
								<div className="person-details">
									<span className="person-name">{requester.name}</span>
									<span className="person-email">{requester.email}</span>
									<span className="person-phone">{requester.phone}</span>
								</div>
							</div>
						) : (
							<span className="text-secondary text-sm">
								Requester info unavailable
							</span>
						)}
					</div>

					{/* Equipment / Asset Context */}
					{asset && (
						<div className="card control-card">
							<h3 className="card-section-title">Equipment Asset</h3>
							<div className="asset-details-list">
								<div className="asset-info-item">
									<span className="asset-label">Asset:</span>
									<span className="asset-val">{asset.name}</span>
								</div>
								<div className="asset-info-item">
									<span className="asset-label">Location:</span>
									<span className="asset-val">{asset.location}</span>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Assign Modal */}
			<Modal
				isOpen={assignModalOpen}
				onClose={() => setAssignModalOpen(false)}
				title="Dispatch Field Assignee"
				description={`Select an available field technician to assign to ticket #${ticket.id}.`}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button
							variant="secondary"
							onClick={() => setAssignModalOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							isLoading={assigning}
							onClick={handleAssignSubmit}
						>
							Confirm Assignment
						</Button>
					</div>
				}
			>
				<form onSubmit={handleAssignSubmit}>
					<Select
						id="assignee-select"
						label="Select Field Technician"
						value={selectedAssigneeId}
						onChange={(e) => setSelectedAssigneeId(e.target.value)}
						required
					>
						<option value="">-- Choose technician --</option>
						{assignableTechs.map((tech) => (
							<option key={tech.id} value={tech.id}>
								{tech.name} — ({tech.email})
							</option>
						))}
					</Select>
				</form>
			</Modal>

			{/* Add Attachment Modal */}
			<Modal
				isOpen={attachModalOpen}
				onClose={() => setAttachModalOpen(false)}
				title="Attach File or Evidence"
				description="Add an image URL documenting evidence or proof of repair completion."
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button
							variant="secondary"
							onClick={() => setAttachModalOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="primary"
							isLoading={attaching}
							onClick={handleAddAttachment}
						>
							Save Attachment
						</Button>
					</div>
				}
			>
				<form onSubmit={handleAddAttachment} className="flex flex-col gap-4">
					<Select
						id="attachment-kind-select"
						label="Attachment Classification"
						value={attachKind}
						onChange={(e) => setAttachKind(e.target.value as AttachmentKind)}
					>
						<option value="issue_evidence">
							Issue Evidence (Problem Photo)
						</option>
						<option value="completion_proof">
							Completion Proof (Resolution Photo)
						</option>
					</Select>

					<Input
						id="modal-attachment-url"
						label="Image Storage URL"
						placeholder="https://example.com/photo.jpg"
						value={attachUrl}
						onChange={(e) => setAttachUrl(e.target.value)}
						required
						leftIcon={<UploadCloud size={16} />}
						helperText="Paste direct image URL (Unsplash or file server link)"
					/>
				</form>
			</Modal>
		</div>
	);
}
