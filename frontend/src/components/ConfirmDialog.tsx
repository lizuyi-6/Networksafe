import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    loading = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <div className="mb-4 flex items-center gap-3">
                    <AlertTriangle className={variant === 'danger' ? 'text-rose-500' : 'text-amber-500'} size={22} />
                    <h3 className="text-base font-semibold text-foreground">{title}</h3>
                </div>
                {description && (
                    <p className="mb-6 text-sm text-muted-foreground">{description}</p>
                )}
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        disabled={loading}
                        className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                            variant === 'danger'
                                ? 'bg-rose-600 hover:bg-rose-700'
                                : 'bg-primary hover:bg-primary/90'
                        }`}
                    >
                        {loading ? '...' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
