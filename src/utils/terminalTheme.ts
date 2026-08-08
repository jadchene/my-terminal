import type { Settings } from '../types';

const LIGHT_FOREGROUND = '#1F2328';
const DARK_FOREGROUND = '#E5E7EB';

export const getTerminalTheme = (mode: Settings['theme']['mode']) => (
  mode === 'light'
    ? {
        background: '#FFFFFF',
        foreground: LIGHT_FOREGROUND,
        cursor: LIGHT_FOREGROUND,
        cursorAccent: '#FFFFFF',
      }
    : {
        background: '#000000',
        foreground: DARK_FOREGROUND,
        cursor: DARK_FOREGROUND,
        cursorAccent: '#000000',
      }
);
