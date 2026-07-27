import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import {
    fetchAdminUsersList,
    updateAdminUserPlan,
    updateAdminUserRole,
    updateAdminUserStatus,
    batchUpdateUsers
} from '../services/api';
import ErrorDisplay from '../components/ErrorDisplay';
import { UserCog, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';

export default function AdminUsers() {
    const { t } = useLanguage();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [batchAction, setBatchAction] = useState<string>('');
    const [batchValue, setBatchValue] = useState<string>('');
    const [showBatchConfirm, setShowBatchConfirm] = useState(false);
    const [batchLoading, setBatchLoading] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const res = await fetchAdminUsersList();
            setUsers(res.users || []);
            setError(null);
        } catch (err: any) {
            setError(err.message || t('adminUsers.load_failed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const handlePlanChange = async (userId: string, newPlan: string) => {
        try {
            await updateAdminUserPlan(userId, newPlan);
            setUsers(users.map(u => u.id === userId ? { ...u, plan: newPlan } : u));
        } catch (e: any) {
            setActionError(e.message || t('adminUsers.update_plan_failed'));
        }
    };

    const handleRoleChange = async (userId: string, newRole: string) => {
        try {
            await updateAdminUserRole(userId, newRole);
            setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
        } catch (e: any) {
            setActionError(e.message || t('adminUsers.update_role_failed'));
        }
    };

    const handleStatusChange = async (userId: string, newStatus: string) => {
        try {
            await updateAdminUserStatus(userId, newStatus);
            setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus } : u));
        } catch (e: any) {
            setActionError(e.message || t('adminUsers.update_status_failed'));
        }
    };

    // Batch selection
    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const toggleSelectAll = () => {
        // Only select non-admin users
        const selectableUsers = users.filter(u => u.role !== 'admin');
        if (selectedIds.size === selectableUsers.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(selectableUsers.map(u => u.id)));
        }
    };

    const executeBatchAction = async () => {
        if (!batchAction || selectedIds.size === 0) return;

        setBatchLoading(true);
        try {
            await batchUpdateUsers({
                userIds: Array.from(selectedIds),
                action: batchAction as any,
                value: batchValue || undefined
            });
            // Reload users after batch operation
            await loadUsers();
            setSelectedIds(new Set());
            setShowBatchConfirm(false);
            setBatchAction('');
            setBatchValue('');
        } catch (e: any) {
            setActionError(e.message || t('adminUsers.batch_failed'));
        } finally {
            setBatchLoading(false);
        }
    };

    const selectableUsers = users.filter(u => u.role !== 'admin');

    if (error) {
        return <ErrorDisplay title={t('adminUsers.error_title')} message={error} onRetry={loadUsers} />;
    }

    if (loading) {
        return <div className="p-8 text-muted-foreground flex items-center justify-center">{t('adminUsers.loading')}</div>;
    }

    return (
        <div data-testid="admin-users-page" className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <UserCog className="text-primary" /> {t('admin_users.title')}
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">{t('admin_users.desc')}</p>
                </div>
            </div>

            {actionError && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
                    {actionError}
                </div>
            )}

            {/* Batch Actions Bar */}
            {selectedIds.size > 0 && (
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex flex-wrap items-center gap-4">
                    <span className="text-sm font-medium text-foreground">
                        {t('adminUsers.selected_count', { count: selectedIds.size })}
                    </span>
                    <select
                        className="bg-background border border-border text-foreground text-xs rounded px-3 py-2"
                        value={batchAction}
                        onChange={(e) => setBatchAction(e.target.value)}
                    >
                        <option value="">{t('adminUsers.select_action')}</option>
                        <option value="suspend">{t('adminUsers.batch_suspend')}</option>
                        <option value="activate">{t('adminUsers.batch_activate')}</option>
                        <option value="setPlan">{t('adminUsers.batch_set_plan')}</option>
                        <option value="setRole">{t('adminUsers.batch_set_role')}</option>
                    </select>
                    {(batchAction === 'setPlan') && (
                        <select
                            className="bg-background border border-border text-foreground text-xs rounded px-3 py-2"
                            value={batchValue}
                            onChange={(e) => setBatchValue(e.target.value)}
                        >
                            <option value="starter">{t('admin_users.plan_starter')}</option>
                            <option value="pro">{t('admin_users.plan_pro')}</option>
                            <option value="ultra">{t('admin_users.plan_ultra')}</option>
                        </select>
                    )}
                    {(batchAction === 'setRole') && (
                        <select
                            className="bg-background border border-border text-foreground text-xs rounded px-3 py-2"
                            value={batchValue}
                            onChange={(e) => setBatchValue(e.target.value)}
                        >
                            <option value="viewer">{t('admin_users.role_viewer')}</option>
                            <option value="tenant">{t('admin_users.role_tenant')}</option>
                        </select>
                    )}
                    <button
                        onClick={() => setShowBatchConfirm(true)}
                        disabled={!batchAction || (['setPlan', 'setRole'].includes(batchAction) && !batchValue)}
                        className={clsx(
                            'px-4 py-2 rounded text-xs font-medium transition-colors',
                            batchAction && (!['setPlan', 'setRole'].includes(batchAction) || batchValue)
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'bg-muted text-muted-foreground cursor-not-allowed'
                        )}
                    >
                        {t('adminUsers.batch_apply')}
                    </button>
                    <button
                        onClick={() => { setSelectedIds(new Set()); setBatchAction(''); setBatchValue(''); }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                    >
                        {t('adminUsers.batch_clear')}
                    </button>
                </div>
            )}

            {/* Batch Confirm Modal */}
            {showBatchConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="text-amber-500" size={24} />
                            <h3 className="text-lg font-bold text-foreground">{t('adminUsers.batch_confirm_title')}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                            {t('adminUsers.batch_confirm_desc', { count: selectedIds.size, action: batchAction })}
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowBatchConfirm(false)}
                                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
                            >
                                {t('adminUsers.batch_cancel')}
                            </button>
                            <button
                                onClick={executeBatchAction}
                                disabled={batchLoading}
                                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                            >
                                {batchLoading ? t('adminUsers.batch_processing') : t('adminUsers.batch_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                        <tr>
                            <th className="px-4 py-4 font-medium w-10">
                                <button
                                    onClick={toggleSelectAll}
                                    className="p-1 hover:bg-muted rounded"
                                    title={t('adminUsers.select_all')}
                                >
                                    {selectedIds.size === selectableUsers.length && selectableUsers.length > 0 ? (
                                        <CheckSquare size={16} className="text-primary" />
                                    ) : (
                                        <Square size={16} />
                                    )}
                                </button>
                            </th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_email')}</th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_role')}</th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_plan')}</th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_status')}</th>
                            <th className="px-6 py-4 font-medium hidden md:table-cell">{t('admin_users.user_last_login')}</th>
                            <th className="px-6 py-4 font-medium">{t('adminUsers.audit')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {users.map((u) => {
                            const isAdmin = u.role === 'admin';
                            const isSelected = selectedIds.has(u.id);
                            return (
                                <tr key={u.id} className={clsx('hover:bg-muted/30 transition-colors', isSelected && 'bg-primary/5')}>
                                    <td className="px-4 py-4">
                                        {!isAdmin && (
                                            <button
                                                onClick={() => toggleSelect(u.id)}
                                                className="p-1 hover:bg-muted rounded"
                                            >
                                                {isSelected ? (
                                                    <CheckSquare size={16} className="text-primary" />
                                                ) : (
                                                    <Square size={16} />
                                                )}
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-foreground">{u.email}</span>
                                            <span className="text-xs text-muted-foreground">{u.id}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <select
                                            className="bg-background border border-border text-foreground text-xs rounded focus:ring-primary focus:border-primary block w-full p-2"
                                            value={u.role}
                                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                        >
                                            <option value="viewer">{t('admin_users.role_viewer')}</option>
                                            <option value="tenant">{t('admin_users.role_tenant')}</option>
                                            <option value="admin">{t('admin_users.role_admin')}</option>
                                        </select>
                                    </td>
                                    <td className="px-6 py-4">
                                        <select
                                            className="bg-background border border-border text-foreground text-xs rounded focus:ring-amber-500 focus:border-amber-500 block w-full p-2"
                                            value={u.plan || 'starter'}
                                            onChange={(e) => handlePlanChange(u.id, e.target.value)}
                                        >
                                            <option value="starter">{t('admin_users.plan_starter')}</option>
                                            <option value="pro">{t('admin_users.plan_pro')}</option>
                                            <option value="ultra">{t('admin_users.plan_ultra')}</option>
                                        </select>
                                    </td>
                                    <td className="px-6 py-4">
                                        <select
                                            className={`text-xs rounded border focus:ring-primary focus:border-primary block w-full p-2 ${u.status === 'active' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                                : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                                                }`}
                                            value={u.status}
                                            onChange={(e) => handleStatusChange(u.id, e.target.value)}
                                        >
                                            <option value="active">{t('admin_users.status_active')}</option>
                                            <option value="suspended">{t('admin_users.status_suspended')}</option>
                                        </select>
                                    </td>
                                    <td className="px-6 py-4 text-xs text-muted-foreground hidden md:table-cell">
                                        {u.last_login ? new Date(u.last_login).toLocaleString() : t('admin_users.never_logged_in')}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            <Link
                                                data-testid={`admin-user-detail-${u.id}`}
                                                to={`/super-admin/users/${encodeURIComponent(u.id)}`}
                                                className="inline-flex rounded border border-border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/40"
                                            >
                                                {t('adminUsers.basic_info')}
                                            </Link>
                                            <Link
                                                data-testid={`admin-user-activity-${u.id}`}
                                                to={`/admin?tab=timeline&tenant=${encodeURIComponent(u.tenant_id || '')}&user=${encodeURIComponent(u.id)}`}
                                                className="inline-flex rounded border border-border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/40"
                                            >
                                                {t('adminUsers.audit')}
                                            </Link>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {users.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground">
                        {t('adminUsers.no_users')}
                    </div>
                )}
            </div>
        </div>
    );
}
