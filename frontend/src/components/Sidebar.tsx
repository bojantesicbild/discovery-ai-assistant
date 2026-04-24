"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getMe } from "@/lib/api";


/**
 * Sidebar — Discovery Redesign v2
 *
 * The visual state (collapsed vs expanded) is driven by the parent via
 * the `.sidebar-expanded` class on the `.app` grid wrapper. This lets
 * the grid template animate both columns in sync. The Sidebar itself
 * just renders the markup; parents toggle the class.
 *
 * Markup follows the design:
 *   .sidebar
 *     .logo-block          two cross-faded marks (compact + brand)
 *     .section-label       "Main" / "Phases" / "System" caption
 *     .nav-group           .nav-item* — icon + label + optional badge + tip
 *     .spacer              pushes the footer down
 *     .sidebar-footer      .avatar-row — avatar + name/email
 */


type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
};

type NavSection = { label: string; items: NavItem[] };


// Icons use strokes on a 24x24 viewBox. Stroke width + colors come from
// CSS (.nav-item svg) so the icons stay in step with theme tokens.
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Main",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: (
          <>
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </>
        ),
      },
    ],
  },
  {
    label: "Phases",
    items: [
      {
        href: "/discovery",
        label: "Discovery",
        badge: 29,
        icon: (
          <>
            <circle cx="12" cy="12" r="9" />
            <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill="currentColor" fillOpacity=".25" />
          </>
        ),
      },
      {
        href: "/story-tech",
        label: "Story & Tech",
        icon: (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M9 4v16" />
          </>
        ),
      },
      {
        href: "/code",
        label: "Code",
        icon: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />,
      },
      {
        href: "/qa",
        label: "QA",
        icon: (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9 12l2 2 4-4" />
          </>
        ),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/documents",
        label: "Documents",
        icon: (
          <>
            <path d="M6 3h9l5 5v13H6z" />
            <path d="M14 3v6h6" />
            <path d="M9 14h7M9 18h5" />
          </>
        ),
      },
      {
        href: "/knowledge",
        label: "Knowledge",
        icon: (
          <>
            <path d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
            <path d="M8 3v18" />
            <path d="M12 7h4M12 11h4" />
          </>
        ),
      },
      {
        href: "/settings/tokens",
        label: "Settings",
        icon: (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
          </>
        ),
      },
    ],
  },
];


function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}


export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    getMe()
      .then((u) => setUser({ name: u.name, email: u.email }))
      .catch(() => {});
  }, []);

  const isActive = (href: string): boolean => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="logo-block">
        <span className="logo-mark" aria-hidden="true">
          <span className="lm-c">C</span>
          <span className="lm-dot">.</span>
        </span>
        <span className="brand-text" aria-label="Crnogorchi">
          Crnogorchi<span className="brand-dot">.</span>
        </span>
      </div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.label} style={{ display: "contents" }}>
          <div className="section-label">
            <span className="sl-text">{section.label}</span>
          </div>
          <div className="nav-group" role="menu">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const badge = item.badge;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "nav-item active" : "nav-item"}
                  title={item.label}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                    {item.icon}
                  </svg>
                  <span className="nav-label">{item.label}</span>
                  {badge !== undefined && badge !== null && badge !== 0 && badge !== "0" ? (
                    <span className="badge">{badge}</span>
                  ) : null}
                  <span className="tip">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <div className="spacer" />

      <div className="sidebar-footer">
        <div className="avatar-row">
          <button className="avatar" title={user?.name || "User"}>
            {user ? getInitials(user.name) : "?"}
          </button>
          <div className="avatar-meta">
            <div className="name">{user?.name || "—"}</div>
            <div className="email">{user?.email || ""}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
