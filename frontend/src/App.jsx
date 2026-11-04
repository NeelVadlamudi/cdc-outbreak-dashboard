import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useState, lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Overview from "./pages/Overview";
import AskData from "./pages/AskData";

// Heavy chart/globe pages — split so the Ask path stays light on first paint.
const MapView = lazy(() => import("./pages/MapView"));
const Forecasts = lazy(() => import("./pages/Forecasts"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Wastewater = lazy(() => import("./pages/Wastewater"));
const AdvancedAnalytics = lazy(() => import("./pages/AdvancedAnalytics"));
const Simulator = lazy(() => import("./pages/Simulator"));

const MotionDiv = motion.div;

const PageTransition = ({ children }) => (
  <MotionDiv
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    style={{ overflow: "hidden", minHeight: "100%" }}
  >
    {children}
  </MotionDiv>
);

function LazyPage({ children }) {
  return (
    <Suspense
      fallback={
        <div className="loading-page">
          <div className="loading-spinner" />
          <div className="loading-page-text">Loading this view…</div>
        </div>
      }
    >
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
        <div className="mobile-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 14, fontFamily: "var(--font-display)" }}>
            <div
              style={{
                background: "var(--accent-cta)",
                width: 30,
                height: 30,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-on-cta)",
                flexShrink: 0,
              }}
              aria-hidden
            >
              <Activity size={15} />
            </div>
            Respiratory Virus Dashboard
          </div>
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <Menu size={22} />
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
