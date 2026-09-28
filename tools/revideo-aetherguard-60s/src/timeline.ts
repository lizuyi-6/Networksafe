export const FPS = 30;
export const DURATION_SECONDS = 60;
export const FULL_RANGE_END = (DURATION_SECONDS * FPS - 1) / FPS;

export const COLORS = {
  background: '#050B14',
  backgroundSoft: '#081525',
  surface: '#0D1B2D',
  surfaceSoft: '#12253B',
  line: '#1E3A52',
  text: '#F8FAFC',
  textSoft: '#94A3B8',
  cyan: '#22D3EE',
  cyanSoft: '#67E8F9',
  blue: '#3B82F6',
  amber: '#F59E0B',
  mint: '#10B981',
  red: '#F43F5E',
} as const;

export const SEGMENTS = {
  breach: 6,
  boundary: 8,
  evidence: 9,
  agents: 10,
  appliance: 12,
  failClosed: 8,
  outro: 7,
} as const;

export const ASSETS = {
  logo: '/assets/aetherguard-logo.png',
  dashboard: '/assets/dashboard.png',
  traffic: '/assets/traffic.png',
  agents: '/assets/agent-monitor.png',
  history: '/assets/history.png',
  appliance: '/assets/appliance.png',
} as const;
