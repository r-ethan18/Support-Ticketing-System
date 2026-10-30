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
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AttachmentPreview } from "../../components/common/AttachmentPreview";
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
import {
	ATTACHMENT_ACCEPT,
	attachmentProblem,
	isMockMode,
	ticketService,
} from "../../services/ticketService";
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
	Vendor,
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
	const [unassigningId, setUnassigningId] = useState<string | null>(null);

	// Vendors responsible for the ticket's asset; only their technicians can be assigned.
	const [assetVendors, setAssetVendors] = useState<Vendor[]>([]);
	const [assetChoice, setAssetChoice] = useState("");
	const [savingAsset, setSavingAsset] = useState(false);

	// Admin-only ticket deletion
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
	const [deletingTicket, setDeletingTicket] = useState(false);

	// Attachment modal
	const [attachModalOpen, setAttachModalOpen] = useState(false);
	const [attachFile, setAttachFile] = useState<File | null>(null);
	const [attachFileKey, setAttachFileKey] = useState(0);
	const [attachKind, setAttachKind] =
		useState<AttachmentKind>("issue_evidence");
	const [attaching, setAttaching] = useState(false);

	// Status update state
	const [updatingStatus, setUpdatingStatus] = useState(false);
	// Real-time SSE callbacks ---------------------------------------------------
	const handleStreamComment = useCallback((newComment: TicketComment) => {
		setComments((prev) => {
			// Deduplicate: the local optimistic update already added this comment
			// if the current user posted it, so skip duplicates by id.
			if (prev.some((c) => c.id === newComment.id)) return prev;
			return [...prev, newComment];
		});
	}, []);

	// The stream only says *what* changed; reload the derived lists from the API.
	const reloadHistory = useCallback(async () => {
		if (!id) return;
		try {
			setHistory(await ticketService.listStatusHistory(id));
		} catch (err) {
			console.warn("Failed to refresh status history", err);
		}
	}, [id]);

	const reloadAssignments = useCallback(async () => {
		if (!id) return;
		try {
			setAssignments(await ticketService.listAssignments(id));
		} catch (err) {
			console.warn("Failed to refresh assignments", err);
		}
	}, [id]);

	const handleStreamStatus = useCallback(
		(ticketId: string, status: TicketStatus, _changedAt: string) => {
			setTicket((prev) =>
				prev && prev.id === ticketId ? { ...prev, status } : prev,
			);
			void reloadHistory();
		},
		[reloadHistory],
	);

	// Events may have been missed (overflow or reconnect): reload everything.
	const handleStreamResync = useCallback(async () => {
		if (!id) return;
		try {
			const [t, c, a, h] = await Promise.all([
				ticketService.getTicket(id),
				ticketService.listComments(id),
				ticketService.listAssignments(id),
				ticketService.listStatusHistory(id),
			]);
			setTicket(t);
			setComments(c);
			setAssignments(a);
			setHistory(h);
		} catch (err) {
			console.warn("Failed to resync ticket", err);
		}
	}, [id]);

	const isLive = useTicketStream(id, {
		onComment: handleStreamComment,
		onStatus: handleStreamStatus,
		onAssignment: reloadAssignments,
		onResync: handleStreamResync,
	});

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

	// Requesters and assignees cannot list people, so look up everyone named on
	// the ticket individually. Each id is tried once; the server decides who is
	// visible, and deleted accounts simply stay unresolved.
	const lookedUp = useRef(new Set<string>());
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the ticket changes
	useEffect(() => {
		lookedUp.current = new Set();
	}, [id]);
	useEffect(() => {
		if (!ticket) return;
		const named = [
			ticket.requesterId,
			ticket.supervisorId,
			...assignments.map((a) => a.assigneeId),
			...comments.map((c) => c.authorId),
			...attachments.map((a) => a.uploadedById),
			...history.map((h) => h.changedById),
		];
		const missing = named.filter(
			(pid): pid is string =>
				!!pid &&
				!lookedUp.current.has(pid) &&
				!people.some((p) => p.id === pid),
		);
		if (missing.length === 0) return;
		for (const pid of missing) lookedUp.current.add(pid);
		ticketService.getPeopleByIds(missing).then((found) => {
			if (found.length === 0) return;
			setPeople((prev) => [
				...prev,
				...found.filter((f) => !prev.some((p) => p.id === f.id)),
			]);
		});
	}, [ticket, assignments, comments, attachments, history, people]);

	const triageAssetId = ticket?.assetId ?? null;
	const canTriage = role === "supervisor" || role === "admin";
	useEffect(() => {
		setAssetChoice(triageAssetId ?? "");
		if (!triageAssetId || !canTriage) {
			setAssetVendors([]);
			return;
		}
		let cancelled = false;
		ticketService
			.listAssetVendors(triageAssetId)
			.then((v) => {
				if (!cancelled) setAssetVendors(v);
			})
			.catch(() => {
				if (!cancelled) setAssetVendors([]);
			});
		return () => {
			cancelled = true;
		};
	}, [triageAssetId, canTriage]);

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
	const asset = assets.find((a) => a.id === ticket.assetId);
	const activeAssignments = assignments.filter((a) => !a.unassignedAt);
	const assignedIds = new Set(activeAssignments.map((a) => a.assigneeId));
	// With an asset set, the backend only accepts technicians of its responsible vendors.
	const assignableTechs = people.filter(
		(p) =>
			p.role === "assignee" &&
			!assignedIds.has(p.id) &&
			(!ticket.assetId || assetVendors.some((v) => v.id === p.vendorId)),
	);
	const triageAssets =
		role === "supervisor"
			? assets.filter((a) => a.departmentId === user?.departmentId)
			: assets;

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
			showToast(
				_err instanceof Error ? _err.message : "Failed to post comment",
				"error",
			);
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
			showToast(
				_err instanceof Error ? _err.message : "Failed to update status",
				"error",
			);
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
				prev && prev.status === "open" ? { ...prev, status: "assigned" } : prev,
			);
			setSelectedAssigneeId("");
			setAssignModalOpen(false);
			showToast("Technician assigned to ticket", "success");
		} catch (_err) {
			showToast(
				_err instanceof Error ? _err.message : "Failed to assign ticket",
				"error",
			);
		} finally {
			setAssigning(false);
		}
	};

	const handleUnassign = async (assignmentId: string) => {
		try {
			setUnassigningId(assignmentId);
			await ticketService.deleteAssignment(ticket.id, assignmentId);
			const remaining = activeAssignments.filter((a) => a.id !== assignmentId);
			setAssignments((prev) =>
				prev.map((a) =>
					a.id === assignmentId
						? { ...a, unassignedAt: new Date().toISOString() }
						: a,
				),
			);
			// Removing the last assignee sends an `assigned` ticket back to `open`.
			if (remaining.length === 0 && ticket.status === "assigned") {
				setTicket({ ...ticket, status: "open" });
			}
			showToast("Technician removed from ticket", "success");
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to unassign",
				"error",
			);
		} finally {
			setUnassigningId(null);
		}
	};

	const handleSaveAsset = async () => {
		if (!assetChoice || assetChoice === ticket.assetId) return;
		try {
			setSavingAsset(true);
			const updated = await ticketService.updateTicket(
				ticket.id,
				{ assetId: assetChoice },
				user?.id || "p-sup-1",
			);
			setTicket(updated);
			showToast("Asset linked to ticket", "success");
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to set asset",
				"error",
			);
		} finally {
			setSavingAsset(false);
		}
	};

	const handleDeleteTicket = async () => {
		try {
			setDeletingTicket(true);
			await ticketService.deleteTicket(ticket.id);
			showToast("Ticket deleted", "success");
			navigate(backUrl);
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Failed to delete ticket",
				"error",
			);
			setDeletingTicket(false);
		}
	};

	const handleAddAttachment = async (e: FormEvent) => {
		e.preventDefault();
		if (!attachFile) return;
		const fileProblem = attachmentProblem(attachFile);
		if (fileProblem) {
			showToast(fileProblem, "error");
			return;
		}

		try {
			setAttaching(true);
			const newAtt = await ticketService.addAttachment(
				ticket.id,
				attachKind,
				attachFile,
				user?.id || "p-user-1",
			);
			setAttachments((prev) => [...prev, newAtt]);
			setAttachFile(null);
			setAttachFileKey((k) => k + 1);
			setAttachModalOpen(false);
			showToast("Attachment uploaded successfully", "success");
		} catch (_err) {
			showToast(
				_err instanceof Error ? _err.message : "Failed to add attachment",
				"error",
			);
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
														<AttachmentPreview attachment={att} />
														<span
															className={`attachment-kind-badge ${att.kind}`}
														>
															{att.kind === "issue_evidence"
																? "Evidence"
																: "Completion Proof"}
														</span>
													</div>
													<div className="attachment-info">
														{att.filename && (
															<span
																className="attachment-filename"
																title={att.filename}
															>
																{att.filename}
															</span>
														)}
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
									<Button
										variant="primary"
										className="w-full bg-emerald"
										onClick={() => {
											setAttachKind("completion_proof");
											setAttachModalOpen(true);
										}}
									>
										Upload Completion Proof
									</Button>
									<Button
										variant="secondary"
										className="w-full"
										onClick={() => {
											setActiveTab("conversation");
											const commentInput = document.getElementById(
												"ticket-reply-textarea",
											);
											if (commentInput) commentInput.focus();
										}}
									>
										Post Progress Update
									</Button>
									<p className="text-xs text-secondary text-center mt-1">
										Assignees submit completion proof and chat updates for
										supervisor sign-off.
									</p>
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
							<h3 className="card-section-title">Assigned Field Techs</h3>
							{canTriage && (
								<Button
									variant="ghost"
									size="sm"
									icon={<UserPlus size={14} />}
									onClick={() => setAssignModalOpen(true)}
								>
									{activeAssignments.length > 0 ? "Add Another" : "Assign"}
								</Button>
							)}
						</div>

						{activeAssignments.length > 0 ? (
							<div className="flex flex-col gap-3">
								{activeAssignments.map((assignment) => {
									const tech = people.find(
										(p) => p.id === assignment.assigneeId,
									);
									return (
										<div key={assignment.id} className="assigned-person-box">
											<Avatar name={tech?.name ?? "Deleted user"} size="md" />
											<div className="person-details">
												<span className="person-name">
													{tech?.name ?? "Deleted user"}
												</span>
												{tech && (
													<>
														<span className="person-email">{tech.email}</span>
														<span className="person-phone">{tech.phone}</span>
													</>
												)}
											</div>
											{canTriage && (
												<Button
													variant="ghost"
													size="sm"
													isLoading={unassigningId === assignment.id}
													onClick={() => handleUnassign(assignment.id)}
												>
													Unassign
												</Button>
											)}
										</div>
									);
								})}
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
					{(asset || canTriage) && (
						<div className="card control-card">
							<h3 className="card-section-title">Equipment Asset</h3>
							{asset && (
								<div className="asset-details-list">
									<div className="asset-info-item">
										<span className="asset-label">Asset:</span>
										<span className="asset-val">{asset.name}</span>
									</div>
									{asset.location && (
										<div className="asset-info-item">
											<span className="asset-label">Location:</span>
											<span className="asset-val">{asset.location}</span>
										</div>
									)}
								</div>
							)}
							{canTriage && ticket.status !== "closed" && (
								<div className="flex flex-col gap-2 mt-2">
									<Select
										id="ticket-asset-select"
										label={asset ? "Change asset" : "Link an asset (triage)"}
										value={assetChoice}
										onChange={(e) => setAssetChoice(e.target.value)}
										className="select-sm"
									>
										<option value="">-- Choose asset --</option>
										{triageAssets.map((a) => (
											<option key={a.id} value={a.id}>
												{a.name}
											</option>
										))}
									</Select>
									<Button
										variant="secondary"
										size="sm"
										isLoading={savingAsset}
										disabled={!assetChoice || assetChoice === ticket.assetId}
										onClick={handleSaveAsset}
									>
										Save Asset
									</Button>
									<p className="text-xs text-secondary">
										Once an asset is set, only technicians of its responsible
										vendors can be assigned.
									</p>
								</div>
							)}
						</div>
					)}

					{role === "admin" && (
						<div className="card control-card mt-4">
							<h3 className="card-section-title">Danger Zone</h3>
							<Button
								variant="danger"
								className="w-full"
								onClick={() => setDeleteModalOpen(true)}
							>
								Delete Ticket
							</Button>
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
					{assignableTechs.length === 0 && (
						<p className="text-xs text-secondary mt-2">
							{ticket.assetId
								? "No available technician works for a vendor responsible for this asset. Link a vendor to the asset, or move a technician to one."
								: "Every technician is already on this ticket."}
						</p>
					)}
				</form>
			</Modal>

			{/* Delete Ticket Modal */}
			<Modal
				isOpen={deleteModalOpen}
				onClose={() => setDeleteModalOpen(false)}
				title="Delete Ticket"
				description={`Permanently delete "${ticket.title}" with its comments, attachments and history?`}
				footer={
					<div className="flex gap-2 justify-end w-full">
						<Button
							variant="secondary"
							onClick={() => setDeleteModalOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="danger"
							isLoading={deletingTicket}
							onClick={handleDeleteTicket}
						>
							Delete Ticket
						</Button>
					</div>
				}
			>
				<p className="text-sm text-secondary">This cannot be undone.</p>
			</Modal>

			{/* Add Attachment Modal */}
			<Modal
				isOpen={attachModalOpen}
				onClose={() => setAttachModalOpen(false)}
				title="Attach File or Evidence"
				description="Upload a photo or PDF documenting evidence or proof of repair completion."
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
						key={attachFileKey}
						id="modal-attachment-file"
						type="file"
						label="File"
						accept={ATTACHMENT_ACCEPT}
						onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
						required
						leftIcon={<UploadCloud size={16} />}
						helperText="PNG, JPEG, GIF, WebP or PDF, up to 10 MB"
					/>
				</form>
			</Modal>
		</div>
	);
}
