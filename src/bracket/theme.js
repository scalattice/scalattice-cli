const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const STRIKE = '\x1b[9m';

/** White, matching the mark SVG. Not cyan. */
const TEXT = '\x1b[38;2;245;245;245m';
const MUTED = '\x1b[38;2;163;163;163m';
const ACCENT = '\x1b[38;2;167;139;250m';
const ACCENT_SOFT = '\x1b[38;2;196;181;253m';
const THINK = ACCENT_SOFT;
const THINK_DIM = '\x1b[38;2;124;108;168m';
const CODE = '\x1b[38;2;221;214;254m';
const RED = '\x1b[38;2;248;113;113m';
const LOGO = TEXT;

export {
  RESET,
  BOLD,
  DIM,
  ITALIC,
  UNDERLINE,
  STRIKE,
  TEXT,
  MUTED,
  ACCENT,
  ACCENT_SOFT,
  THINK,
  THINK_DIM,
  CODE,
  RED,
  LOGO,
};
