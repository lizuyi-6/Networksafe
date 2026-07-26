export function buildAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin && origin.toLowerCase() !== 'null');

  const origins = configured && configured.length > 0 ? configured : [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];

  return Array.from(new Set(origins));
}
