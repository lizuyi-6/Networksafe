import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import {
    fetchAdminUsersList,
    updateAdminUserPlan,
    updateAdminUserRole,
    updateAdminUserStatus
} from '../services/api';
import ErrorDisplay from '../components/ErrorDisplay';
import { UserCog } from 'lucide-react';

export default function AdminUsers() {
    const { t } = useLanguage();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
            alert(e.message || t('adminUsers.update_plan_failed'));
        }
    };

    const handleRoleChange = async (userId: string, newRole: string) => {
        try {
            await updateAdminUserRole(userId, newRole);
            setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
        } catch (e: any) {
            alert(e.message || t('adminUsers.update_role_failed'));
        }
    };

    const handleStatusChange = async (userId: string, newStatus: string) => {
        try {
            await updateAdminUserStatus(userId, newStatus);
            setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus } : u));
        } catch (e: any) {
            alert(e.message || t('adminUsers.update_status_failed'));
        }
    };

    if (error) {
        return <ErrorDisplay title={t('adminUsers.error_title')} message={error} onRetry={loadUsers} />;
    }

    if (loading) {
        return <div className="p-8 text-muted-foreground flex items-center justify-center">{t('adminUsers.loading')}</div>;
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                        <UserCog className="text-primary" /> {t('admin_users.title')}
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">{t('admin_users.desc')}</p>
                </div>
            </div>

            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b border-border">
                        <tr>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_email')}</th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_role')}</th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_plan')}</th>
                            <th className="px-6 py-4 font-medium">{t('admin_users.user_status')}</th>
                            <th className="px-6 py-4 font-medium hidden md:table-cell">{t('admin_users.user_last_login')}</th>
                            <th className="px-6 py-4 font-medium">{t('adminUsers.audit')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {users.map((u) => (
                            <tr key={u.id} className="hover:bg-muted/30 transition-colors">
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
                                    {u.last_login ? new Date(u.last_login).toLocaleString() : t('admin_users.status_suspended')}
                                </td>
                                <td className="px-6 py-4">
                                    <Link
                                        data-testid={`admin-user-activity-${u.id}`}
                                        to={`/admin?tab=timeline&tenant=${encodeURIComponent(u.tenant_id || '')}&user=${encodeURIComponent(u.id)}`}
                                        className="inline-flex rounded border border-border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/40"
                                    >
                                        {t('adminUsers.view_activity')}
                                    </Link>
                                </td>
                            </tr>
                        ))}
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
