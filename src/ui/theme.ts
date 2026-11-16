// TODO: real brand colours / logo (PLAN.md section 12).
export const colors = {
  background: '#F6F4F0',
  surface: '#FFFFFF',
  text: '#1C1917',
  textMuted: '#57534E',
  border: '#DAD5CE',
  primary: '#1C1917',
  onPrimary: '#FFFFFF',
  accent: '#9A3412',
  accentSoft: '#FDF1E7',
  success: '#166534',
  successSoft: '#E8F5EC',
  danger: '#B91C1C',
  dangerSoft: '#FDECEC',
  disabled: '#A8A29E',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, pill: 999 } as const;
export const font = { sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 } as const;

/** Minimum comfortable touch target. */
export const TOUCH = 48;
/** Content column width on large screens. */
export const CONTENT_WIDTH = 520;
