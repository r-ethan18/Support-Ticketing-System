import {
	AlertCircle,
	ArrowLeft,
	FileText,
	MapPin,
	Send,
	UploadCloud,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { Select } from "../../components/common/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ticketService } from "../../services/ticketService";
import type { Asset, TicketPriority } from "../../types/api";

export function CreateTicketPage() {
	const { user } = useAuth();
	const { showToast } = useToast();
	const navigate = useNavigate();

	const [title, setTitle] = useState("");
	const [location, setLocation] = useState("");
	const [priority, setPriority] = useState<TicketPriority>("medium");
	const [description, setDescription] = useState("");
	const [selectedAssetId, setSelectedAssetId] = useState("");
	const [attachmentUrl, setAttachmentUrl] = useState("");

	const [assets, setAssets] = useState<Asset[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	useEffect(() => {
		async function loadOptions() {
			try {
				const loadedAssets = await ticketService.listAssets();
				setAssets(loadedAssets);
			} catch (err) {
				console.error("Failed to load assets", err);
			}
		}
		loadOptions();
	}, []);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setFormError(null);

		if (!title.trim()) {
			setFormError("Please provide a descriptive subject/title.");
			return;
		}
		if (!location.trim()) {
			setFormError("Please specify the physical location of the issue.");
			return;
		}
		if (!description.trim() || description.trim().length < 10) {
			setFormError("Please provide a description with at least 10 characters.");
			return;
		}

		try {
			setSubmitting(true);
			const created = await ticketService.createTicket(
				{
					title: title.trim(),
					location: location.trim(),
					priority,
					description: description.trim(),
				},
				user?.id || "p-req-1",
				selectedAssetId || undefined,
			);

			if (attachmentUrl.trim()) {
				await ticketService.addAttachment(
					created.id,
					"issue_evidence",
					attachmentUrl.trim(),
					user?.id || "p-req-1",
				);
			}

			showToast(
				`Ticket #${created.id} submitted successfully! Our dispatch team has been notified.`,
				"success",
			);
			navigate(`/requester/tickets/${created.id}`);
		} catch (err) {
			setFormError(
				err instanceof Error
					? err.message
					: "Failed to create ticket. Please check connection.",
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="page-wrapper max-w-4xl">
			<div className="breadcrumb-nav mb-4">
				<button
					type="button"
					className="back-btn"
					onClick={() => navigate("/requester/tickets")}
				>
					<ArrowLeft size={16} />
					<span>Back to My Tickets</span>
				</button>
			</div>

			<div className="page-header">
				<div>
					<h2 className="page-title">Submit Service Request</h2>
					<p className="page-description">
						Describe the incident or service requirement. Our dispatchers will
						route your ticket to the appropriate department.
					</p>
				</div>
			</div>

			{formError && (
				<div className="alert alert-danger mb-4" role="alert">
					<AlertCircle size={18} />
					<span>{formError}</span>
				</div>
			)}

			<div className="card form-card">
				<form onSubmit={handleSubmit} className="ticket-form">
					<div className="form-grid-2">
						<div className="col-span-2">
							<Input
								id="ticket-title"
								name="title"
								label="Subject / Issue Summary"
								placeholder="e.g. Conference room video screen blinking or AC failure"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								leftIcon={<FileText size={16} />}
								required
								helperText="Keep the subject concise and descriptive."
							/>
						</div>

						<div>
							<Input
								id="ticket-location"
								name="location"
								label="Physical Location / Office Pod"
								placeholder="e.g. Building B, Room 302 or Desk 42"
								value={location}
								onChange={(e) => setLocation(e.target.value)}
								leftIcon={<MapPin size={16} />}
								required
								helperText="Where can field assignees find the affected equipment?"
							/>
						</div>

						<div>
							<Select
								id="ticket-priority"
								name="priority"
								label="Urgency / Priority"
								value={priority}
								onChange={(e) => setPriority(e.target.value as TicketPriority)}
								required
							>
								<option value="low">
									Low — General inquiry or minor issue
								</option>
								<option value="medium">
									Medium — Normal operational impact
								</option>
								<option value="high">
									High — Significant business disruption
								</option>
								<option value="critical">
									Critical — Immediate outage or safety hazard
								</option>
							</Select>
						</div>

						<div className="col-span-2">
							<Select
								id="ticket-asset"
								name="assetId"
								label="Related Equipment / Facility Asset (Optional)"
								value={selectedAssetId}
								onChange={(e) => {
									setSelectedAssetId(e.target.value);
									const asset = assets.find((a) => a.id === e.target.value);
									if (asset && !location) {
										setLocation(asset.location);
									}
								}}
							>
								<option value="">-- No specific asset or not listed --</option>
								{assets.map((a) => (
									<option key={a.id} value={a.id}>
										{a.name} — ({a.location})
									</option>
								))}
							</Select>
						</div>

						<div className="col-span-2 form-group">
							<label htmlFor="ticket-description" className="form-label">
								Detailed Description <span className="text-danger">*</span>
							</label>
							<textarea
								id="ticket-description"
								name="description"
								rows={5}
								className="form-textarea"
								placeholder="Explain what happened, what troubleshooting you've tried, and any relevant error codes..."
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								required
							/>
							<p className="form-helper">
								Provide enough detail for field technicians to prepare required
								tools.
							</p>
						</div>

						<div className="col-span-2 form-group">
							<label htmlFor="attachment-url" className="form-label">
								Evidence / Photo URL (Optional)
							</label>
							<Input
								id="attachment-url"
								name="attachmentUrl"
								placeholder="https://example.com/photo.png or paste image link"
								value={attachmentUrl}
								onChange={(e) => setAttachmentUrl(e.target.value)}
								leftIcon={<UploadCloud size={16} />}
								helperText="Add a photo link of the broken hardware or error screenshot."
							/>
						</div>
					</div>

					<div className="form-actions">
						<Button
							type="button"
							variant="secondary"
							onClick={() => navigate("/requester/tickets")}
							disabled={submitting}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							isLoading={submitting}
							icon={<Send size={16} />}
						>
							Submit Service Ticket
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
