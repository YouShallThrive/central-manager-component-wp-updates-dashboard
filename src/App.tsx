import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicLayout } from "./components/PublicLayout";
import { PublicOnlyRoute } from "./components/PublicOnlyRoute";
import { SSOGate } from "./components/SSOGate";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./contexts/ThemeContext";
import {
  DashboardPage,
  EnvatoPage,
  LandingPage,
  LiveSitesPage,
  LoginPage,
  SettingsPage,
  SignupPage,
  SiteDetailPage,
  SitesPage,
  UpdatesPage,
} from "./pages";
import RocketRedirectPage from "./pages/RocketRedirectPage";

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" switchable>
        <Toaster />
        <Routes>
          {/* SSO Gate wraps everything to intercept ?sso_token= */}
          <Route element={<SSOGate />}>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<LandingPage />} />
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/sites" element={<SitesPage />} />
                <Route path="/sites/by-rocket/:rocketSiteId" element={<RocketRedirectPage />} />
                <Route path="/sites/:siteId" element={<SiteDetailPage />} />
                <Route path="/live-sites" element={<LiveSitesPage />} />
                <Route path="/live-sites/:siteId" element={<SiteDetailPage />} />
                <Route path="/updates" element={<UpdatesPage />} />
                <Route path="/updates/:jobId" element={<UpdatesPage />} />
                <Route path="/envato" element={<EnvatoPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
