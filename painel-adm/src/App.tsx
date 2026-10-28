import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { InstitutionalBannersPage } from "@/pages/InstitutionalBannersPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RegistrationsPage } from "@/pages/RegistrationsPage";
import { FeedManagementPage } from "@/pages/FeedManagementPage";
const FeedEditorPage = lazy(() => import("@/pages/FeedEditorPage").then((module) => ({ default: module.FeedEditorPage })));
const FeedMediaLibraryPage = lazy(() => import("@/pages/FeedMediaLibraryPage").then((module) => ({ default: module.FeedMediaLibraryPage })));
const FeedCategoriesPage = lazy(() => import("@/pages/FeedCategoriesPage").then((module) => ({ default: module.FeedCategoriesPage })));
const FeedPreviewPage = lazy(() => import("@/pages/FeedPreviewPage").then((module) => ({ default: module.FeedPreviewPage })));

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
        <Route path="/conteudo/feed" element={<FeedManagementPage />} />
        <Route path="/conteudo/feed/novo" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo editor editorial…</div>}><FeedEditorPage /></Suspense>} />
        <Route path="/conteudo/feed/previa/:token" element={<Suspense fallback={<div role="status" className="p-12 text-center">Abrindo prévia…</div>}><FeedPreviewPage /></Suspense>} />
        <Route path="/conteudo/feed/:id/editar" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo editor editorial…</div>}><FeedEditorPage /></Suspense>} />
        <Route path="/conteudo/feed/midias" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo biblioteca…</div>}><FeedMediaLibraryPage /></Suspense>} />
        <Route path="/conteudo/feed/categorias" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo categorias…</div>}><FeedCategoriesPage /></Suspense>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
