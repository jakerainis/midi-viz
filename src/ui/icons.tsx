/** Small inline icons from the design canvas. They use currentColor unless a colour is passed. */
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const svg = (size: number, vb: number, props: SVGProps<SVGSVGElement>, children: ReactNode) => (
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} aria-hidden="true" {...props}>
    {children}
  </svg>
);

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Logo = ({ size = 22, ...p }: P) =>
  svg(size, 22, p, (
    <>
      <rect x="2" y="10" width="3" height="10" rx="1" fill="var(--dim)" />
      <rect x="7" y="4" width="3" height="16" rx="1" fill="var(--accent)" />
      <rect x="12" y="13" width="3" height="7" rx="1" fill="var(--dim)" />
      <rect x="17" y="7" width="3" height="13" rx="1" fill="var(--muted)" />
    </>
  ));

export const Chevron = ({ size = 12, ...p }: P) => svg(size, 12, p, <path d="M3 4.5l3 3 3-3" {...stroke} strokeWidth="1.5" />);
export const ChevronRight = ({ size = 12, ...p }: P) => svg(size, 12, p, <path d="M4.5 3l3 3-3 3" {...stroke} strokeWidth="1.5" />);
export const ToStart = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, <path d="M4 3v10M13 3.5L6.5 8 13 12.5z" {...stroke} strokeWidth="1.6" />);
export const Play = ({ size = 16, ...p }: P) => svg(size, 16, p, <path d="M5 3l8 5-8 5z" fill="currentColor" />);
export const Stop = ({ size = 16, ...p }: P) => svg(size, 16, p, <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />);
export const Loop = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, <path d="M3 7V6a2 2 0 012-2h7l-2-2M13 9v1a2 2 0 01-2 2H4l2 2" {...stroke} strokeWidth="1.6" />);
export const Metronome = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, <path d="M6 2h4l3 12H3zM8 10l4-6" {...stroke} strokeWidth="1.5" />);
export const KitIcon = ({ size = 14, ...p }: P) =>
  svg(size, 14, p, (
    <>
      <ellipse cx="7" cy="5" rx="5.5" ry="2.2" {...stroke} strokeWidth="1.3" />
      <path d="M1.5 5v4c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V5" {...stroke} strokeWidth="1.3" />
    </>
  ));
export const Undo = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, <path d="M6 4L3 7l3 3M3 7h6.5a3.5 3.5 0 010 7H8" {...stroke} strokeWidth="1.5" />);
export const Redo = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, <path d="M10 4l3 3-3 3M13 7H6.5a3.5 3.5 0 000 7H8" {...stroke} strokeWidth="1.5" />);
export const Download = ({ size = 14, ...p }: P) =>
  svg(size, 14, p, <path d="M7 1.5v7.5M4 6l3 3 3-3M2 11v1.5h10V11" {...stroke} strokeWidth="1.6" />);
export const Search = ({ size = 14, ...p }: P) =>
  svg(size, 14, p, (
    <>
      <circle cx="6" cy="6" r="4.2" {...stroke} strokeWidth="1.4" />
      <path d="M9.2 9.2L12.5 12.5" {...stroke} strokeWidth="1.4" />
    </>
  ));
export const Pointer = ({ size = 13, ...p }: P) => svg(size, 13, p, <path d="M2.5 1.5l8 4.2-3.6 1-1.4 3.6z" fill="currentColor" />);
export const Pencil = ({ size = 13, ...p }: P) =>
  svg(size, 13, p, <path d="M2 11l1-3.2 6-6 2.2 2.2-6 6zM8 3l2.2 2.2" {...stroke} strokeWidth="1.3" />);
export const Scissors = ({ size = 13, ...p }: P) =>
  svg(size, 13, p, <path d="M6.5 1v11M3 4L1 6.5 3 9M10 4l2 2.5L10 9" {...stroke} strokeWidth="1.3" />);
export const Eraser = ({ size = 13, ...p }: P) =>
  svg(size, 13, p, <path d="M5 11.5h6M2.5 8.5l5-5.5 3.5 3.2-5 5.3H4.5z" {...stroke} strokeWidth="1.3" />);
export const LineTool = ({ size = 13, ...p }: P) => svg(size, 13, p, <path d="M2 11L11 2" {...stroke} strokeWidth="1.5" />);
export const Close = ({ size = 14, ...p }: P) => svg(size, 14, p, <path d="M3 3l8 8M11 3l-8 8" {...stroke} strokeWidth="1.6" />);
export const Minus = ({ size = 12, ...p }: P) => svg(size, 12, p, <path d="M2.5 6h7" {...stroke} strokeWidth="1.6" />);
export const Plus = ({ size = 12, ...p }: P) => svg(size, 12, p, <path d="M2.5 6h7M6 2.5v7" {...stroke} strokeWidth="1.6" />);
export const Check = ({ size = 12, ...p }: P) => svg(size, 12, p, <path d="M2.5 6.2l2.3 2.3 4.7-5" {...stroke} strokeWidth="1.6" />);
export const Warn = ({ size = 12, ...p }: P) =>
  svg(size, 12, p, <path d="M6 1.5l5 9H1zM6 5v2.5M6 9v.2" {...stroke} strokeWidth="1.3" />);
export const Link = ({ size = 11, ...p }: P) =>
  svg(size, 11, p, (
    <path
      d="M4.5 6.5l2-2M3.6 5.2L2.4 6.4a1.6 1.6 0 002.2 2.2l1.2-1.2M7.4 5.8l1.2-1.2a1.6 1.6 0 00-2.2-2.2L5.2 3.6"
      {...stroke}
      strokeWidth="1.2"
    />
  ));
export const Bars = ({ size = 10, ...p }: P) =>
  svg(size, 10, p, (
    <>
      <rect x="1" y="2" width="1.6" height="6" fill="currentColor" />
      <rect x="4.2" y="1" width="1.6" height="8" fill="currentColor" />
      <rect x="7.4" y="3" width="1.6" height="4" fill="currentColor" />
    </>
  ));
export const Sun = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, (
    <>
      <circle cx="8" cy="8" r="3" {...stroke} strokeWidth="1.4" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" {...stroke} strokeWidth="1.4" />
    </>
  ));
export const Moon = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, <path d="M13 9.5A5.5 5.5 0 116.5 3a4.5 4.5 0 006.5 6.5z" {...stroke} strokeWidth="1.4" />);
export const Auto = ({ size = 16, ...p }: P) =>
  svg(size, 16, p, (
    <>
      <circle cx="8" cy="8" r="5.5" {...stroke} strokeWidth="1.4" />
      <path d="M8 2.5v11a5.5 5.5 0 000-11z" fill="currentColor" />
    </>
  ));
