export type IconSize = "xs" | "sm" | "md" | "lg";
const SIZE_MAP: Record<IconSize, number> = { xs: 12, sm: 16, md: 20, lg: 24 };
export type IconName =
  | "grid" | "id" | "chat" | "camera" | "radar" | "fire" | "film"
  | "edit" | "trash" | "plus" | "check" | "flask" | "book" | "sparkle"
  | "calendar" | "settings" | "mic" | "chart" | "chevronDown" | "arrowRight";
const ICON_PATHS: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  id: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.5-1.5 1.8-2.5 3-2.5s2.5 1 3 2.5M14 9.5h4M14 13h4" strokeLinecap="round" /></>,
  chat: <path d="M4 4h16v12H11l-5 4v-4H4V4z" strokeLinejoin="round" />,
  camera: <><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z" strokeLinejoin="round" /><path d="M9 4v13M15 7v13" /></>,
  radar: <><circle cx="12" cy="12" r="9" /><path d="M12 12L6.5 6.5M12 3v2M21 12h-2M12 21v-2M3 12h2" strokeLinecap="round" /></>,
  fire: <path d="M12 2C7 7 5 10 5 14a7 7 0 0 0 14 0c0-3-1.5-5-4-7-1 2-2 3-3 3z" strokeLinejoin="round" />,
  film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M3 15h18M8 5v4M8 15v4M16 5v4M16 15v4" strokeLinecap="round" /></>,
  edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" /></>,
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  check: <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />,
  flask: <><path d="M9 2v6.5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 8.5V2" /><path d="M7 14h10" strokeLinecap="round" /><path d="M9 2h6" strokeLinecap="round" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" strokeLinecap="round" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9H20M8 3V6M16 3V6" strokeLinecap="round" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11C5 14.866 8.13401 18 12 18C15.866 18 19 14.866 19 11" strokeLinecap="round" /><path d="M12 18V21M9 21H15" strokeLinecap="round" /></>,
  chart: <><path d="M4 19V13M9 19V8M14 19V11M19 19V5" strokeLinecap="round" /><path d="M3 19H21" strokeLinecap="round" /></>,
  chevronDown: <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />,
  arrowRight: <path d="M5 12H19M19 12L13 6M19 12L13 18" strokeLinecap="round" strokeLinejoin="round" />,
};
export function Icon({ name, size = "sm", className }: { name: IconName; size?: IconSize; className?: string }) {
  const px = SIZE_MAP[size];
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      {ICON_PATHS[name]}
    </svg>
  );
}
export function ChevronDown({ className }: { className?: string }) {
  return <Icon name="chevronDown" size="sm" className={className} />;
}
