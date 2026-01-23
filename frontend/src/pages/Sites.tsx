import React, { useEffect, useState } from 'react';
import { fetchSites } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

const Sites = () => {
    const { t } = useLanguage();
    const [sites, setSites] = useState<any[]>([]);

    useEffect(() => {
        fetchSites().then(data => setSites(data)).catch(console.error);
    }, []);

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-900">{t('sites.title')}</h1>
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="font-semibold text-lg text-gray-800">{t('sites.protected_domains')}</h2>
                </div>
                <div className="p-8">
                    {sites.length === 0 ? (
                        <p className="text-center text-gray-500">{t('sites.no_sites')}</p>
                    ) : (
                        <ul className="space-y-2">
                            {sites.map((site: any) => (
                                <li key={site.id} className="flex justify-between p-4 bg-white border border-gray-100 rounded-lg shadow-sm">
                                    <span>{site.domain}</span>
                                    <span className={site.status === 'secure' ? 'text-green-500' : 'text-yellow-500'}>{site.status}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};
export default Sites;
