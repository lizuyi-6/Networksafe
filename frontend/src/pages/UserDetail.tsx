import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import {
    fetchAdminUserDetail,
    fetchUserLoginHistory,
    resetUserPassword,
    updateAdminUserRole,
    updateAdminUserPlan,
    updateAdminUserStatus
} from '../services/api';
import ErrorDisplay from '../components/ErrorDisplay';
import {
    ArrowLeft,
    User,
    Mail,
    Clock,
    Key,
    AlertTriangle,
    History,
    RefreshCw
} from 'lucide-react';
import { clsx } from 'clsx';

interface LoginHistory {
    id: string;
    ip_address: string;
    user_agent: string;
    status: string;
    created_at: string;
    logout_at: string | null;
}

interface UserDetail {
    id: string;
    email: string;
    role: string;
    plan: string;
    status: string;
    created_at: string;
    last_login: string | null;
    tenant_id: string | null;
}

export default function UserDetailPage() {
    const { t } = useLanguage();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [user, setUser] = useState<UserDetail | null>(null);
    const [loginHistory, setLoginHistory] = useState<LoginHistory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [resetLoading, setResetLoading] = useState(false);
    const [newPassword, setNewPassword] = useState<string | null>(null);

    const loadData = async () => {
        if (!id) return;
        try {
            setLoading(true);
            const [userRes, historyRes] = await Promise.all([
                fetchAdminUserDetail(id),
                fetchUserLoginHistory(id, 20)
            ]);
            setUser(userRes.user);
            setLoginHistory(historyRes.history || []);
            setError(null);
        } catch (err: any) {
            setError(err.message || t('adminUsers.load_failed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [id]);

    const handleRoleChange = async (newRole: string) => {
        if (!user) return;
        try {
            await updateAdminUserRole(user.id, newRole);
            setUser({ ...user, role: newRole });
        } catch (e: any) {
            alert(e.message || t('adminUsers.update_role_failed'));
        }
    };

    const handlePlanChange = async (newPlan: string) => {
        if (!user) return;
        try {
            await updateAdminUserPlan(user.id, newPlan);
            setUser({ ...user, plan: newPlan });
        } catch (e: any) {
            alert(e.message || t('adminUsers.update_plan_failed'));
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        if (!user) return;
        try {
            await updateAdminUserStatus(user.id, newStatus);
            setUser({ ...user, status: newStatus });
        } catch (e: any) {
            alert(e.message || t('adminUsers.update_status_failed'));
        }
    };

    const handleResetPassword = async () => {
        if (!user) return;
        if (!confirm(t('adminUsers.reset_password_confirm'))) return;
        try {
            setResetLoading(true);
            const res = await resetUserPassword(user.id);
            setNewPassword(res.temporaryPassword);
        } catch (e: any) {
            alert(e.message || t('adminUsers.reset_password_failed'));
        } finally {
            setResetLoading(false);
        }
    };

    if (error) {
        return <ErrorDisplay title={t('adminUsers.error_title')} message={error} onRetry={loadData} />;
    }

    if (loading || !user) {
        return <div className="p-8 text-muted-foreground flex items-center justify-center">{t('adminUsers.loading')}</div>;
    }

    const statusColors = {
        active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        suspended: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    };

    return (
        <div className="mx-auto max-w-[1680px] space-y-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            {/* Header */}
            <div className="flex flex-col items-start justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-center">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/super-admin')}
                        aria-label={t('adminUsers.back') || 'Back to users'}
                        title={t('adminUsers.back') || 'Back to users'}
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                    >
                        <ArrowLeft size={20} className="text-muted-foreground" />
                    </button>
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground sm:text-2xl">
                            <User className="text-primary" size={22} /> {user.email}
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">{t('adminUsers.user_detail_desc')}</p>
                    </div>
                </div>
            </div>

            {/* Main Info Card */}
            <div className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <User size={18} /> {t('adminUsers.basic_info')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">{t('admin_users.user_email')}</label>
                        <div className="mt-1 flex items-center gap-2">
                            <Mail size={16} className="text-muted-foreground" />
                            <span className="text-foreground">{user.email}</span>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">{t('admin_users.user_role')}</label>
                        <select
                            className="mt-1 bg-background border border-border text-foreground text-sm rounded px-3 py-2 w-full"
                            value={user.role}
                            onChange={(e) => handleRoleChange(e.target.value)}
                        >
                            <option value="viewer">{t('admin_users.role_viewer')}</option>
                            <option value="tenant">{t('admin_users.role_tenant')}</option>
                            <option value="admin">{t('admin_users.role_admin')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">{t('admin_users.user_plan')}</label>
                        <select
                            className="mt-1 bg-background border border-border text-foreground text-sm rounded px-3 py-2 w-full"
                            value={user.plan || 'starter'}
                            onChange={(e) => handlePlanChange(e.target.value)}
                        >
                            <option value="starter">{t('admin_users.plan_starter')}</option>
                            <option value="pro">{t('admin_users.plan_pro')}</option>
                            <option value="ultra">{t('admin_users.plan_ultra')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">{t('admin_users.user_status')}</label>
                        <select
                            className={clsx(
                                'mt-1 text-sm rounded border px-3 py-2 w-full',
                                statusColors[user.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground border-border'
                            )}
                            value={user.status}
                            onChange={(e) => handleStatusChange(e.target.value)}
                        >
                            <option value="active">{t('admin_users.status_active')}</option>
                            <option value="suspended">{t('admin_users.status_suspended')}</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">{t('adminUsers.created_at')}</label>
                        <div className="mt-1 flex items-center gap-2">
                            <Clock size={16} className="text-muted-foreground" />
                            <span className="text-foreground">{new Date(user.created_at).toLocaleString()}</span>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">{t('admin_users.user_last_login')}</label>
                        <div className="mt-1 flex items-center gap-2">
                            <Clock size={16} className="text-muted-foreground" />
                            <span className="text-foreground">
                                {user.last_login ? new Date(user.last_login).toLocaleString() : t('adminUsers.never_login')}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions Card */}
            <div className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Key size={18} /> {t('adminUsers.actions')}
                </h2>
                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={handleResetPassword}
                        disabled={resetLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={resetLoading ? 'animate-spin' : ''} />
                        {resetLoading ? t('adminUsers.resetting') : t('adminUsers.reset_password')}
                    </button>
                </div>

                {/* New Password Display */}
                {newPassword && (
                    <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="text-amber-500" size={18} />
                            <span className="text-sm font-medium text-foreground">{t('adminUsers.temporary_password')}</span>
                        </div>
                        <code className="block bg-background p-3 rounded text-sm font-mono border border-border">
                            {newPassword}
                        </code>
                        <p className="text-xs text-muted-foreground mt-2">{t('adminUsers.temporary_password_hint')}</p>
                    </div>
                )}
            </div>

            {/* Login History Card */}
            <div className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <History size={18} /> {t('adminUsers.login_history')}
                </h2>
                {loginHistory.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                        {t('adminUsers.no_login_history')}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                                <tr>
                                    <th className="px-4 py-3 font-medium">{t('adminUsers.login_time')}</th>
                                    <th className="px-4 py-3 font-medium">{t('adminUsers.login_ip')}</th>
                                    <th className="px-4 py-3 font-medium">{t('adminUsers.login_status')}</th>
                                    <th className="px-4 py-3 font-medium hidden md:table-cell">{t('adminUsers.user_agent')}</th>
                                    <th className="px-4 py-3 font-medium hidden lg:table-cell">{t('adminUsers.logout_time')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loginHistory.map((h) => (
                                    <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-4 py-3 text-foreground">
                                            {new Date(h.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                                            {h.ip_address || '-'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={clsx(
                                                'px-2 py-1 rounded text-xs font-medium',
                                                h.status === 'success'
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                            )}>
                                                {h.status === 'success' ? t('adminUsers.login_success') : t('adminUsers.login_failed')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell max-w-xs truncate">
                                            {h.user_agent || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">
                                            {h.logout_at ? new Date(h.logout_at).toLocaleString() : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
