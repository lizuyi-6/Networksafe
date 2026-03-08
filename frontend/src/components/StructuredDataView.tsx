type StructuredDataViewProps = {
    value: unknown;
    emptyLabel?: string;
    depth?: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const humanizeKey = (key: string) =>
    key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (char) => char.toUpperCase());

const formatPrimitive = (value: string | number | boolean) => {
    if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value) : String(value);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
        return parsed.toLocaleString();
    }

    return value;
};

const StructuredDataView = ({ value, emptyLabel = 'No data available', depth = 0 }: StructuredDataViewProps) => {
    if (value === null || value === undefined || value === '') {
        return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return <span className="text-sm text-foreground">{formatPrimitive(value)}</span>;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
        }

        const primitiveItems = value.every(
            (item) => item === null || item === undefined || ['string', 'number', 'boolean'].includes(typeof item)
        );

        if (primitiveItems) {
            return (
                <div className="flex flex-wrap gap-2">
                    {value.map((item, index) => (
                        <span
                            key={`${String(item)}-${index}`}
                            className="rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-foreground"
                        >
                            {item === null || item === undefined || item === '' ? emptyLabel : formatPrimitive(item as string | number | boolean)}
                        </span>
                    ))}
                </div>
            );
        }

        return (
            <div className="space-y-2">
                {value.map((item, index) => (
                    <div key={index} className="rounded-lg border border-border bg-muted/10 p-3">
                        <StructuredDataView value={item} emptyLabel={emptyLabel} depth={depth + 1} />
                    </div>
                ))}
            </div>
        );
    }

    if (!isPlainObject(value)) {
        return <span className="text-sm text-foreground">{String(value)}</span>;
    }

    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    if (entries.length === 0) {
        return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
    }

    return (
        <div className={depth === 0 ? 'grid gap-2 md:grid-cols-2' : 'space-y-2'}>
            {entries.map(([key, entryValue]) => (
                <div key={key} className="rounded-lg border border-border bg-muted/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        {humanizeKey(key)}
                    </div>
                    <div className="mt-2">
                        <StructuredDataView value={entryValue} emptyLabel={emptyLabel} depth={depth + 1} />
                    </div>
                </div>
            ))}
        </div>
    );
};

export default StructuredDataView;
