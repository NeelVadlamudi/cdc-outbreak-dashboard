import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  TestTubes,
  TrendingUp,
  MessageSquare,
  Hospital,
  LineChart,
  Microscope,
  Activity,
  X,
} from "lucide-react";

const navItems = [
  {
    section: "Monitor",
    items: [
      { path: "/", label: "Overview", icon: LayoutDashboard },
      { path: "/map", label: "Map", icon: Map },
      { path: "/analytics", label: "Trends", icon: LineChart },
      { path: "/wastewater", label: "Wastewater", icon: TestTubes },
    ],
  },
  {
    section: "Ask & plan",
    items: [
      { path: "/ask", label: "Ask a question", icon: MessageSquare },
      { path: "/forecasts", label: "Outlook", icon: TrendingUp },
      { path: "/simulator", label: "Surge planning", icon: Hospital },
    ],
  },
  {
    section: "More",
    items: [
      { path: "/advanced", label: "Technical details", icon: Microscope },
    ],
  },
];

export default function Sidebar({ isOpen, setIsOpen }) {
  return (
    <>
      <div
        className={`sidebar-overlay ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(false)}
        aria-hidden={!isOpen}
      />
      <aside className={`sidebar ${isOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon" aria-hidden>
              <Activity size={20} strokeWidth={2.25} />
            </div>
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-title">Respiratory Virus Dashboard</div>
              <div className="sidebar-logo-subtitle">CDC open data</div>
            </div>
            <button
              className="mobile-menu-btn"
              style={{ marginLeft: "auto", display: isOpen ? "flex" : "none" }}
              onClick={() => setIsOpen(false)}
              aria-label="Close navigation"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((group) => (
            <div key={group.section} style={{ marginBottom: 12 }}>
              <div className="nav-section-label">{group.section}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                    onClick={() => setIsOpen(false)}
                  >
                    {({ isActive }) => (
                      <>
                        <div className="nav-item-icon">
                          <Icon
                            size={18}
                            strokeWidth={isActive ? 2.4 : 2}
                            color={isActive ? "var(--accent-primary)" : "currentColor"}
                          />
                        </div>
                        {item.label}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="live-indicator">
            <span className="live-dot" aria-hidden />
            Data updates about every hour
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 6, paddingLeft: 15 }}>
            Source: CDC public surveillance
          </div>
        </div>
      </aside>
    </>
  );
}
