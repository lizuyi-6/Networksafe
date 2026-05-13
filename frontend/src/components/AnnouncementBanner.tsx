import { useEffect, useState } from 'react';
import { X, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { fetchPublicAnnouncements } from '../services/api';

interface Announcement {
    id: string;
    title: string;
    content: string;
    type: 'info' | 'warning' | 'critical';
    published_at: string;
    expires_at: string | null;
}

const dismissedKey = 'announcements_dismissed';

export default function AnnouncementBanner() {
    const { t } = useLanguage();
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Load dismissed IDs from localStorage
        try {
            const stored = localStorage.getItem(dismissedKey);
            if (stored) {
                setDismissed(new Set(JSON.parse(stored)));
            }
        } catch {
            // ignore
        }

        // Fetch active announcements
        const load = async () => {
            try {
                const res = await fetchPublicAnnouncements();
                setAnnouncements(Array.isArray(res) ? res : []);
            } catch (err) {
                console.warn('Failed to fetch announcements:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const dismissAnnouncement = (id: string) => {
        const newDismissed = new Set(dismissed);
        newDismissed.add(id);
        setDismissed(newDismissed);
        try {
            localStorage.setItem(dismissedKey, JSON.stringify(Array.from(newDismissed)));
        } catch {
            // ignore
        }
    };

    if (loading || announcements.length === 0) {
        return null;
    }

    // Filter out dismissed and expired announcements
    const now = new Date();
    const visibleAnnouncements = announcements.filter(a => {
        if (dismissed.has(a.id)) return false;
        if (a.expires_at && new Date(a.expires_at) < now) return false;
        return true;
    });

    if (visibleAnnouncements.length === 0) {
        return null;
    }

    const getIcon = (type: string) => {
        switch (type) {
            case 'critical':
                return <AlertCircle className="text-red-500 shrink-0" size={18} />;
            case 'warning':
                return <AlertTriangle className="text-amber-500 shrink-0" size={18} />;
            default:
                return <Info className="text-blue-500 shrink-0" size={18} />;
        }
    };

    const getBgClass = (type: string) => {
        switch (type) {
            case 'critical':
                return 'bg-red-500/10 border-red-500/20';
            case 'warning':
                return 'bg-amber-500/10 border-amber-500/20';
            default:
                return 'bg-blue-500/10 border-blue-500/20';
        }
    };

    // Only show the first (most recent) announcement
    const announcement = visibleAnnouncements[0];

    return (
        <div className={`border-b ${getBgClass(announcement.type)} border-b px-4 py-2`}>
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {getIcon(announcement.type)}
                    <div className="min-w-0">
                        <span className="font-medium text-sm text-foreground truncate">
                            {announcement.title}
                        </span>
                        {announcement.content && (
                            <span className="text-sm text-muted-foreground ml-2 hidden sm:inline truncate">
                                {announcement.content}
                            </span>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => dismissAnnouncement(announcement.id)}
                    className="shrink-0 p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                    title={t('announcement.dismiss')}
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}
