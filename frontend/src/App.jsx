import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Overview from "./pages/Overview";
import MapView from "./pages/MapView";
import Forecasts from "./pages/Forecasts";
import Analytics from "./pages/Analytics";
import Wastewater from "./pages/Wastewater";
import AdvancedAnalytics from "./pages/AdvancedAnalytics";
import AskData from "./pages/AskData";
import Simulator from "./pages/Simulator";
import CustomCursor from "./components/CustomCursor";

const PageTransition = ({ children }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ overflow: "hidden", minHeight: "100%" }}
    >
      {children}
    </motion.div>
  );
};

function AppRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Overview /></PageTransition>} />
        <Route path="/map" element={<PageTransition><MapView /></PageTransition>} />
        <Route path="/forecasts" element={<PageTransition><Forecasts /></PageTransition>} />
        <Route path="/analytics" element={<PageTransition><Analytics /></PageTransition>} />
        <Route path="/ask" element={<PageTransition><AskData /></PageTransition>} />
        <Route path="/simulator" element={<PageTransition><Simulator /></PageTransition>} />
        <Route path="/wastewater" element={<PageTransition><Wastewater /></PageTransition>} />
        <Route path="/advanced" element={<PageTransition><AdvancedAnalytics /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Router>
      <div className="app-layout">
        <CustomCursor />
        {/* Mobile Header */}
        <div className="mobile-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800 }}>
            <div style={{ background: 'var(--accent-gradient)', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
              <Menu size={16} /> {/* Temporary icon */}
            </div>
            CDC Outbreak AI
          </div>
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
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
