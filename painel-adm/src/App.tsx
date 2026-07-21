import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { InstitutionalBannersPage } from "@/pages/InstitutionalBannersPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RegistrationsPage } from "@/pages/RegistrationsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route
          path="/"
          element={<Navigate to="/ouvintes/cadastros" replace />}
        />
        <Route path="/ouvintes/cadastros" element={<RegistrationsPage />} />
        <Route path="/campanhas" element={<CampaignsPage />} />
        <Route path="/banners-institucionais" element={<InstitutionalBannersPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
