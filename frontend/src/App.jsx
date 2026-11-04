import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useState, lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Overview from "./pages/Overview";
import AskData from "./pages/AskData";
import CustomCursor from "./components/CustomCursor";

// Heavy chart/globe pages — split so the Ask demo path is not a 7MB first paint.
const MapView = lazy(() => import("./pages/MapView"));
const Forecasts = lazy(() => import("./pages/Forecasts"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Wastewater = lazy(() => import("./pages/Wastewater"));
const AdvancedAnalytics = lazy(() => import("./pages/AdvancedAnalytics"));
const Simulator = lazy(() => import("./pages/Simulator"));

// Module-scope alias: core no-unused-vars does not see JSX member use (<MotionDiv>).
const MotionDiv = motion.div;

const PageTransition = ({ children }) => {
  return (
    <MotionDiv
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ overflow: "hidden", minHeight: "100%" }}
    >
      {children}
    </MotionDiv>
  );
};

function LazyPage({ children }) {
  return (
    <Suspense fallback={<div className="page-container fade-in" style={{ padding: 24 }}>Loading…</div>}>
      {children}
    </Suspense>
  );
}

function AppRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Overview /></PageTransition>} />
        <Route path="/map" element={<PageTransition><LazyPage><MapView /></LazyPage></PageTransition>} />
        <Route path="/forecasts" element={<PageTransition><LazyPage><Forecasts /></LazyPage></PageTransition>} />
        <Route path="/analytics" element={<PageTransition><LazyPage><Analytics /></LazyPage></PageTransition>} />
        <Route path="/ask" element={<PageTransition><AskData /></PageTransition>} />
        <Route path="/simulator" element={<PageTransition><LazyPage><Simulator /></LazyPage></PageTransition>} />
        <Route path="/wastewater" element={<PageTransition><LazyPage><Wastewater /></LazyPage></PageTransition>} />
        <Route path="/advanced" element={<PageTransition><LazyPage><AdvancedAnalytics /></LazyPage></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Router basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <div className="app-layout">
        <CustomCursor />
        {/* Mobile Header */}
        <div className="mobile-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800 }}>
            <div style={{ background: 'var(--accent-gradient)', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }} aria-hidden>
              <Activity size={16} />
            </div>
            CDC Respiratory Virus Dashboard
          </div>
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <Menu size={24} />
          </button>
        </div>

        <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        
        <main className="main-content">
          <AppRoutes />
        </main>
      </div>
    </Router>
  );
}

export default App;
