/**
 * Hand-drawn stroke icon set. Kept inline (rather than an icon font or emoji)
 * so the packaged app has zero external assets and every glyph inherits the
 * current text colour, which keeps contrast correct in both themes.
 */

export type IconName =
  | 'vault' | 'search' | 'plus' | 'minus' | 'pencil' | 'trash' | 'tag'
  | 'fields' | 'settings' | 'arrowUp' | 'arrowDown' | 'chevronDown'
  | 'chevronLeft' | 'chevronRight' | 'close' | 'check' | 'download'
  | 'upload' | 'folder' | 'alert' | 'box' | 'barcode' | 'filter'
  | 'sun' | 'moon' | 'monitor' | 'info' | 'sort' | 'save' | 'image' | 'staff';

const paths: Record<IconName, React.ReactNode> = {
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8V6.5M12 17.5V16M8 12H6.5M17.5 12H16" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  pencil: (
    <>
      <path d="M4 20l.9-3.9L16.3 4.8a2 2 0 0 1 2.9 2.9L7.9 19.1 4 20z" />
      <path d="M14.5 6.6l2.9 2.9" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4.8h6V7" />
      <path d="M6.5 7l.9 12.2A1.5 1.5 0 0 0 8.9 20.5h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 11.2V4.5a1 1 0 0 1 1-1h6.7a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.7 6.7a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  fields: (
    <>
      <path d="M4 6h11M4 12h11M4 18h7" />
      <path d="M18 14.5v6M15 17.5h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </>
  ),
  arrowUp: <path d="M12 20V4.8M6.5 10.3 12 4.8l5.5 5.5" />,
  arrowDown: <path d="M12 4v15.2M6.5 13.7 12 19.2l5.5-5.5" />,
  chevronDown: <path d="M6 9.5 12 15.5 18 9.5" />,
  chevronLeft: <path d="M14.5 6 8.5 12l6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5 9.5 17 19 7.5" />,
  download: (
    <>
      <path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 19h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 19h15" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.5a1 1 0 0 1 1-1h4.3a1 1 0 0 1 .8.4l1.2 1.6h8.7a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
    </>
  ),
  alert: (
    <>
      <path d="M10.7 4.2 2.9 17.6a1.5 1.5 0 0 0 1.3 2.3h15.6a1.5 1.5 0 0 0 1.3-2.3L13.3 4.2a1.5 1.5 0 0 0-2.6 0z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.8 12 3.2l8.5 4.6v8.4L12 20.8l-8.5-4.6z" />
      <path d="M3.5 7.8 12 12.4l8.5-4.6" />
      <path d="M12 12.4v8.4" />
    </>
  ),
  barcode: (
    <>
      <path d="M3.5 5.5v13M6.5 5.5v13M9.5 5.5v9M12.5 5.5v13M15.5 5.5v9M18.5 5.5v13M21 5.5v13" />
    </>
  ),
  filter: <path d="M3.5 5.5h17l-6.6 7.7v5.4l-3.8 2v-7.4z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.6" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  sort: <path d="M7 4.5v15M4 16.5 7 19.5l3-3M17 19.5v-15M14 7.5 17 4.5l3 3" />,
  staff: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16.5 5.6a3.2 3.2 0 0 1 0 6.2M17.5 14.3a5.5 5.5 0 0 1 3 5.2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.75" />
      <path d="M3.5 17l4.8-4.6a2 2 0 0 1 2.7 0L16 17M14.6 14.4l1.7-1.6a2 2 0 0 1 2.7 0l1.5 1.4" />
    </>
  ),
  save: (
    <>
      <path d="M4.5 5.5a1 1 0 0 1 1-1h10.2L19.5 8.3v10.2a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" />
      <path d="M8 4.5v5h7v-5M8 19.5V14h8v5.5" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
