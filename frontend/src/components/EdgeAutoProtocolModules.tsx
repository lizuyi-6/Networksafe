import type {
    EdgeAutoDashboardModuleSummary,
    AgentProtocolPolicy,
    AgentProtocolStats,
    EdgeAutoModuleManifest,
    EdgeFinopsStats,
    ProtocolModuleManifest,
} from '../types/edge-auto';
import type { JsonObject } from '../types/json';

const inputClassName = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground';

function asProtocolModules(manifests: EdgeAutoModuleManifest[]): ProtocolModuleManifest[] {
    return manifests.filter((item): item is ProtocolModuleManifest => item.kind === 'protocol');
}

function modulePolicyValue(policy: AgentProtocolPolicy | null | undefined, moduleId: string, fieldKey: string, type: string) {
    const value = policy?.modules?.[moduleId]?.[fieldKey];
    if (type === 'boolean') return Boolean(value);
    if (type === 'number') return Number(value || 0);
    if (type === 'string_array') return Array.isArray(value) ? value : [];
    return value;
}

function numericField(source: JsonObject | null | undefined, fieldKey: string): number {
    const value = source?.[fieldKey];
    return typeof value === 'number' ? value : Number(value || 0);
}

function metricValue(
    manifest: ProtocolModuleManifest,
    stats: AgentProtocolStats | null | undefined,
    finops: EdgeFinopsStats | null | undefined,
    summary?: EdgeAutoDashboardModuleSummary | null
) {
    const moduleStats = stats?.modules?.[manifest.moduleId];
    const moduleFinops = finops?.modules?.[manifest.moduleId];
    const moduleCounters = summary?.counters || moduleStats?.counters || {};

    if (manifest.capabilities.includes('finops_savings')) {
        return {
            value: `${Number((summary?.estimatedSavedMb ?? moduleFinops?.estimatedSavedMb) || 0).toFixed(3)} MB`,
            hint: `${Number((summary?.savedMessages ?? moduleFinops?.savedMessages) || 0)} saved msgs`
        };
    }

    if (manifest.capabilities.includes('vehicle_authorization') || manifest.capabilities.includes('threat_detection')) {
        return {
            value: `${Number((summary?.findings ?? moduleStats?.findings) || 0)}`,
            hint: `${Number((summary?.evaluations ?? moduleStats?.evaluations) || 0)} evals`
        };
    }

    return {
        value: `${Number((summary?.evaluations ?? moduleStats?.evaluations) || 0)}`,
        hint: `${Object.keys(moduleCounters).length} counters`
    };
}

export const EdgeAutoProtocolPolicyEditor = ({
    manifests,
    value,
    onChange,
}: {
    manifests: EdgeAutoModuleManifest[];
    value: AgentProtocolPolicy | null;
    onChange: (next: AgentProtocolPolicy) => void;
}) => {
    const protocolModules = asProtocolModules(manifests);
    if (!value) {
        return null;
    }

    return (
        <div className="space-y-4">
            {protocolModules.map((manifest) => (
                <div key={manifest.moduleId} className="rounded-xl border border-border bg-muted/15 p-4">
                    <div className="mb-3">
                        <div className="text-sm font-semibold text-foreground">{manifest.displayName}</div>
                        <div className="text-xs text-muted-foreground">{manifest.moduleId}</div>
                    </div>
                    {Object.keys(manifest.policySchema).length === 0 ? (
                        <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                            This module has no editable policy fields in v1.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {Object.entries(manifest.policySchema).map(([fieldKey, fieldSchema]) => {
                                const moduleValue = value.modules?.[manifest.moduleId] || {};
                                if (fieldSchema.type === 'boolean') {
                                    return (
                                        <label key={fieldKey} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                                            <input
                                                type="checkbox"
                                                checked={modulePolicyValue(value, manifest.moduleId, fieldKey, fieldSchema.type) as boolean}
                                                onChange={(event) => onChange({
                                                    ...value,
                                                    modules: {
                                                        ...value.modules,
                                                        [manifest.moduleId]: {
                                                            ...moduleValue,
                                                            [fieldKey]: event.target.checked
                                                        }
                                                    }
                                                })}
                                            />
                                            <span>
                                                <span className="block text-sm text-foreground">{fieldSchema.label}</span>
                                                {fieldSchema.description && <span className="block text-xs text-muted-foreground">{fieldSchema.description}</span>}
                                            </span>
                                        </label>
                                    );
                                }

                                if (fieldSchema.type === 'number') {
                                    return (
                                        <label key={fieldKey} className="block space-y-1">
                                            <span className="text-muted-foreground">{fieldSchema.label}</span>
                                            <input
                                                type="number"
                                                min={fieldSchema.min}
                                                max={fieldSchema.max}
                                                step={fieldSchema.step || 1}
                                                value={modulePolicyValue(value, manifest.moduleId, fieldKey, fieldSchema.type) as number}
                                                onChange={(event) => onChange({
                                                    ...value,
                                                    modules: {
                                                        ...value.modules,
                                                        [manifest.moduleId]: {
                                                            ...moduleValue,
                                                            [fieldKey]: Number(event.target.value || 0)
                                                        }
                                                    }
                                                })}
                                                className={inputClassName}
                                            />
                                            {fieldSchema.description && <span className="block text-xs text-muted-foreground">{fieldSchema.description}</span>}
                                        </label>
                                    );
                                }

                                return (
                                    <label key={fieldKey} className="block space-y-1">
                                        <span className="text-muted-foreground">{fieldSchema.label}</span>
                                        <input
                                            value={(modulePolicyValue(value, manifest.moduleId, fieldKey, fieldSchema.type) as string[]).join(', ')}
                                            onChange={(event) => onChange({
                                                ...value,
                                                modules: {
                                                    ...value.modules,
                                                    [manifest.moduleId]: {
                                                        ...moduleValue,
                                                        [fieldKey]: event.target.value.split(',').map((item) => item.trim()).filter(Boolean)
                                                    }
                                                }
                                            })}
                                            placeholder={fieldSchema.placeholder}
                                            className={inputClassName}
                                        />
                                        {fieldSchema.description && <span className="block text-xs text-muted-foreground">{fieldSchema.description}</span>}
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export const EdgeAutoProtocolSummaryGrid = ({
    manifests,
    stats,
    finops,
    summary,
    compact = false,
}: {
    manifests: EdgeAutoModuleManifest[];
    stats: AgentProtocolStats | null | undefined;
    finops: EdgeFinopsStats | null | undefined;
    summary?: Record<string, EdgeAutoDashboardModuleSummary> | null | undefined;
    compact?: boolean;
}) => {
    const protocolModules = asProtocolModules(manifests);
    return (
        <div className={`grid grid-cols-1 gap-4 ${compact ? 'md:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-2'}`}>
            {protocolModules.map((manifest) => {
                const moduleSummary = summary?.[manifest.moduleId];
                const primary = metricValue(manifest, stats, finops, moduleSummary);
                const moduleStats = stats?.modules?.[manifest.moduleId];
                const counters = moduleSummary?.counters || moduleStats?.counters || {};
                return (
                    <div key={manifest.moduleId} className="rounded-xl border border-border bg-muted/15 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold text-foreground">{manifest.displayName}</div>
                                <div className="text-xs text-muted-foreground">{manifest.moduleId}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-lg font-semibold text-foreground">{primary.value}</div>
                                <div className="text-xs text-muted-foreground">{primary.hint}</div>
                            </div>
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {Object.entries(manifest.statsSchema).map(([fieldKey, fieldSchema]) => {
                                const statValue = counters?.[fieldKey]
                                    ?? numericField(moduleSummary as unknown as JsonObject | undefined, fieldKey)
                                    ?? numericField(moduleStats as unknown as JsonObject | undefined, fieldKey)
                                    ?? numericField(finops?.modules?.[manifest.moduleId] as unknown as JsonObject | undefined, fieldKey)
                                    ?? 0;
                                return (
                                    <div key={fieldKey} className="flex items-center justify-between">
                                        <span>{fieldSchema.label}</span>
                                        <span className="font-medium text-foreground">
                                            {fieldSchema.unit === 'bytes' ? Number(statValue || 0).toLocaleString() : Number(statValue || 0).toLocaleString()}
                                        </span>
                                    </div>
                                );
                            })}
                            <div className="flex items-center justify-between">
                                <span>Last event</span>
                                <span className="font-medium text-foreground">
                                    {(moduleSummary?.lastEventAt || moduleStats?.lastEventAt)
                                        ? new Date(moduleSummary?.lastEventAt || moduleStats?.lastEventAt || '').toLocaleString()
                                        : 'Never'}
                                </span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
