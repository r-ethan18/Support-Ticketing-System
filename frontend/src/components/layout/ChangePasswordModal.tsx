import { type FormEvent, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { authService } from "../../services/authService";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";

interface ChangePasswordModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const MIN_LENGTH = 12;

export function ChangePasswordModal({
	isOpen,
	onClose,
}: ChangePasswordModalProps) {
	const { user } = useAuth();
	const { showToast } = useToast();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const close = () => {
		setCurrent("");
		setNext("");
		setConfirm("");
		setError(null);
		onClose();
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (next.length < MIN_LENGTH) {
			setError(`The new password must be at least ${MIN_LENGTH} characters.`);
			return;
		}
		if (next !== confirm) {
			setError("The new passwords do not match.");
			return;
		}
		if (next === current) {
			setError("The new password must differ from the current one.");
			return;
		}
		setSaving(true);
		try {
			await authService.changePassword(user?.email ?? "", current, next);
			showToast(
				"Password changed. Other devices have been signed out.",
				"success",
			);
			close();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to change password",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={close}
			title="Change Password"
			description="Changing your password signs you out on every other device."
			footer={
				<div className="flex gap-2 justify-end w-full">
					<Button variant="secondary" onClick={close}>
						Cancel
					</Button>
					<Button variant="primary" isLoading={saving} onClick={handleSubmit}>
						Change Password
					</Button>
				</div>
			}
		>
			<form onSubmit={handleSubmit} className="flex flex-col gap-4">
				{error && (
					<div className="login-error-alert" role="alert">
						<span>{error}</span>
					</div>
				)}
				<Input
					id="current-password"
					type="password"
					label="Current password"
					autoComplete="current-password"
					value={current}
					onChange={(e) => setCurrent(e.target.value)}
					required
				/>
				<Input
					id="new-password"
					type="password"
					label="New password"
					autoComplete="new-password"
					minLength={MIN_LENGTH}
					maxLength={128}
					value={next}
					onChange={(e) => setNext(e.target.value)}
					required
				/>
				<Input
					id="confirm-password"
					type="password"
					label="Confirm new password"
					autoComplete="new-password"
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					required
				/>
			</form>
		</Modal>
	);
}
