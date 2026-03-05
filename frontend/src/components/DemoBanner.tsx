/**
 * Demo Banner Component
 *
 * Displays a banner at the top of the page when demo mode is active.
 * This provides clear visual indication that the system is running in demo mode.
 */

import { useDemo } from '../context/DemoContext';
import { useTranslation } from 'react-i18next';

export function DemoBanner() {
  const { isDemoMode, modeResolved, dataSource } = useDemo();
  const { t } = useTranslation();

  // Don't render until mode is resolved
  if (!modeResolved) {
    return null;
  }

  // Don't render if not in demo mode
  if (!isDemoMode) {
    return null;
  }

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium">
      <div className="flex items-center justify-center gap-2">
        {/* Demo icon */}
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>

        {/* Demo mode text */}
        <span>
          {t('demo.banner_title', 'Demo Mode')}
        </span>

        {/* Data source indicator */}
        <span className="text-amber-800">
          ({t('demo.data_source', 'Data Source')}: {dataSource === 'api' ? t('demo.api', 'API') : t('demo.local', 'Local')})
        </span>

        {/* Separator */}
        <span className="text-amber-700">|</span>

        {/* Info text */}
        <span className="text-amber-900">
          {t('demo.banner_info', 'Using demonstration data from backend')}
        </span>
      </div>
    </div>
  );
}

export default DemoBanner;
