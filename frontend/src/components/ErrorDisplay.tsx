import React from 'react';

interface ErrorDisplayProps {
    title?: string;
    message: string;
    onRetry?: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
    title = 'Error Loading Data',
    message,
    onRetry
}) => {
    return (
        <div className="p-8 flex flex-col items-center justify-center text-red-500">
            <p className="text-xl font-bold mb-2">{title}</p>
            <p className="text-sm font-mono bg-red-50 p-3 rounded border border-red-100">
                {message}
            </p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
                >
                    Retry
                </button>
            )}
        </div>
    );
};

export default ErrorDisplay;
