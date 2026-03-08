import { NavLink } from "react-router-dom";
import { 
  LayoutDashboard, 
  Map, 
  TestTubes, 
  Bot, 
  Microscope, 
  MessageSquare, 
  Hospital, 
  LineChart, 
  Activity,
  X
} from "lucide-react";

const navItems = [
  { section: "Dashboard", items: [
    { path: "/", label: "Command Center", icon: LayoutDashboard },
    { path: "/map", label: "Geo-Spatial Intel", icon: Map },
    { path: "/wastewater", label: "Bio-Surveillance", icon: TestTubes },
  ]},
  { section: "Intelligence", items: [
    { path: "/forecasts", label: "Predictive Engine", icon: Bot },
    { path: "/advanced", label: "Quantum Insights", icon: Microscope },
    { path: "/ask", label: "Neural Interface", icon: MessageSquare },
  ]},
  { section: "Tools", items: [
    { path: "/simulator", label: "Surge Matrix", icon: Hospital },
    { path: "/analytics", label: "Data Core", icon: LineChart },
  ]},
];

export default function Sidebar({ isOpen, setIsOpen }) {
  return (
    <>
      <div 
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`} 
        onClick={() => setIsOpen(false)}
      />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <Activity size={24} strokeWidth={2.5} />
            </div>
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-title">CDC Outbreak AI</div>
              <div className="sidebar-logo-subtitle">Surveillance Dashboard</div>
            </div>
            {/* Mobile close button inside header if open */}
            <button 
              className="mobile-menu-btn" 
              style={{ marginLeft: 'auto', display: isOpen ? 'block' : 'none' }}
              onClick={() => setIsOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((group) => (
            <div key={group.section} style={{ marginBottom: 16 }}>
              <div className="nav-section-label">{group.section}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                    onClick={() => setIsOpen(false)} // Close on mobile click
                  >
                    {({ isActive }) => (
                      <>
                        <div className="nav-item-icon">
                          <Icon size={18} strokeWidth={isActive ? 2.5 : 2} color={isActive ? "var(--accent-primary)" : "currentColor"} />
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
            <span className="live-dot"></span>
            Live · CDC SODA API
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4, paddingLeft: 16 }}>
            Data refreshes every 60 min
          </div>
        </div>
      </aside>
    </>
  );
}
