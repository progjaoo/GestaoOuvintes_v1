import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { CampaignsPage } from "@/pages/CampaignsPage";
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
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
