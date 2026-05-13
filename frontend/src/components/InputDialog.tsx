import { useState } from 'react';

interface InputDialogProps {
    open: boolean;
    title: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export default function InputDialog({
    open,
    title,
    label,
    placeholder,
    defaultValue = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
}: InputDialogProps) {
    const [value, setValue] = useState(defaultValue);

    if (!open) return null;

    const handleConfirm = () => {
        onConfirm(value);
        setValue('');
    };

    const handleCancel = () => {
        setValue('');
        onCancel();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <h3 className="mb-4 text-base font-semibold text-foreground">{title}</h3>
                {label && (
                    <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
                )}
                <textarea
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
                <div className="mt-4 flex justify-end gap-3">
                    <button
                        onClick={handleCancel}
                        className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
