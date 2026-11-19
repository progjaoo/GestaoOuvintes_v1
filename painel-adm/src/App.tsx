import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { PermissionRoute, ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getDefaultAccessPath, getDefaultAdminPath } from "@/services/permissions";
import { useAuth } from "@/contexts/AuthContext";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { InstitutionalBannersPage } from "@/pages/InstitutionalBannersPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RegistrationsPage } from "@/pages/RegistrationsPage";
import { FeedManagementPage } from "@/pages/FeedManagementPage";
import { AdminUsersPage } from "@/pages/AdminUsersPage";
import { AdminUserDetailPage } from "@/pages/AdminUserDetailPage";
import { AdminRolesPage } from "@/pages/AdminRolesPage";
import { AdminAccessLayout } from "@/pages/AdminAccessLayout";
import { AdminScreenAccessPage } from "@/pages/AdminScreenAccessPage";
import { IdentityActionPage } from "@/pages/IdentityActionPage";
const ProgramsPage = lazy(() => import("@/pages/ProgramsPage").then(module => ({ default: module.ProgramsPage })));
const FeedEditorPage = lazy(() => import("@/pages/FeedEditorPage").then((module) => ({ default: module.FeedEditorPage })));
const FeedMediaLibraryPage = lazy(() => import("@/pages/FeedMediaLibraryPage").then((module) => ({ default: module.FeedMediaLibraryPage })));
const FeedCategoriesPage = lazy(() => import("@/pages/FeedCategoriesPage").then((module) => ({ default: module.FeedCategoriesPage })));
const FeedPreviewPage = lazy(() => import("@/pages/FeedPreviewPage").then((module) => ({ default: module.FeedPreviewPage })));

const PollWorkspacePage = lazy(() => import("@/pages/PollWorkspacePage").then(module => ({ default: module.PollWorkspacePage })));
const PollsPage = lazy(() => import("@/pages/PollsPage").then(module => ({ default: module.PollsPage })));
const PollEditorPage = lazy(() => import("@/pages/PollEditorPage").then(module => ({ default: module.PollEditorPage })));
const CalendarIntegrationPage = lazy(() => import("@/pages/CalendarIntegrationPage").then(module => ({ default: module.CalendarIntegrationPage })));
const PollCalendarPage = lazy(() => import("@/pages/PollCalendarPage").then(module => ({ default: module.PollCalendarPage })));

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={getDefaultAdminPath(user)} replace />;
}

function AccessRedirect() {
  const { user } = useAuth();
  return <Navigate to={getDefaultAccessPath(user) ?? "/sem-acesso"} replace />;
}

function LegacyAdminUserRedirect() {
  const { userId = "" } = useParams();
  return <Navigate to={`/administracao/acessos/usuarios/${userId}`} replace />;
}

function PollAreaRedirect() {
  const { user } = useAuth();
  const calendarPermissions = [
    "calendar_integration.read",
    "calendar_integration.manage",
    "calendar_integration.sync",
  ];
  if (calendarPermissions.some((permission) => user?.permissions?.includes(permission))) {
    return <Navigate to="/enquetes/calendario" replace />;
  }
  if (["poll.read", "poll.results.read", "participation.read"].some((permission) => user?.permissions?.includes(permission))) {
    return <Navigate to="/enquetes/gestao" replace />;
  }
  return <Navigate to="/sem-acesso" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/definir-senha" element={<IdentityActionPage action="password" />} />
      <Route path="/confirmar-email" element={<IdentityActionPage action="email" />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/participacoes" element={<Navigate to="/enquetes" replace />} />
        <Route path="/enquetes/:id/resultados" element={<Suspense fallback={<div role="status">Abrindo resultados…</div>}><PollWorkspacePage /></Suspense>} />
        <Route path="/enquetes" element={<PollAreaRedirect />} />
        <Route element={<PermissionRoute permission={["calendar_integration.read", "calendar_integration.manage", "calendar_integration.sync"]} />}>
          <Route path="/enquetes/calendario" element={<Suspense fallback={<div role="status">Abrindo calendário…</div>}><PollCalendarPage /></Suspense>} />
        </Route>
        <Route element={<PermissionRoute permission={["poll.read", "poll.results.read", "participation.read"]} />}>
          <Route path="/enquetes/gestao" element={<Suspense fallback={<div role="status">Abrindo enquetes…</div>}><PollsPage /></Suspense>} />
        </Route>
        <Route element={<PermissionRoute permission={["calendar_integration.read", "calendar_integration.manage", "calendar_integration.sync"]} />}>
          <Route path="/enquetes/integracao" element={<Suspense fallback={<div role="status">Abrindo integração…</div>}><CalendarIntegrationPage /></Suspense>} />
        </Route>
        <Route element={<PermissionRoute permission="poll.read" />}>
          <Route element={<PermissionRoute permission="poll.manage" />}><Route path="/enquetes/nova" element={<Suspense fallback={<div role="status">Abrindo editor…</div>}><PollEditorPage /></Suspense>} /></Route>
          <Route path="/enquetes/:id" element={<Suspense fallback={<div role="status">Abrindo enquete…</div>}><PollEditorPage /></Suspense>} />
        </Route>
        <Route element={<PermissionRoute permission="program.read" />}><Route path="/programas" element={<Suspense fallback={<div role="status">Abrindo programas…</div>}><ProgramsPage /></Suspense>} /></Route>
        <Route element={<PermissionRoute permission="listener.read" />}>
          <Route path="/ouvintes/cadastros" element={<RegistrationsPage />} />
        </Route>
        <Route element={<PermissionRoute permission="campaign.read" />}>
          <Route path="/campanhas" element={<CampaignsPage />} />
        </Route>
        <Route element={<PermissionRoute permission="institutional_banner.read" />}>
          <Route path="/banners-institucionais" element={<InstitutionalBannersPage />} />
        </Route>
        <Route element={<PermissionRoute permission="feed.read" />}>
          <Route path="/conteudo/feed" element={<FeedManagementPage />} />
          <Route path="/conteudo/feed/previa/:token" element={<Suspense fallback={<div role="status" className="p-12 text-center">Abrindo prévia…</div>}><FeedPreviewPage /></Suspense>} />
        </Route>
        <Route element={<PermissionRoute permission="feed.edit" />}>
          <Route path="/conteudo/feed/novo" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo editor editorial…</div>}><FeedEditorPage /></Suspense>} />
          <Route path="/conteudo/feed/:id/editar" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo editor editorial…</div>}><FeedEditorPage /></Suspense>} />
          <Route path="/conteudo/feed/categorias" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo categorias…</div>}><FeedCategoriesPage /></Suspense>} />
        </Route>
        <Route element={<PermissionRoute permission="feed.media.manage" />}>
          <Route path="/conteudo/feed/midias" element={<Suspense fallback={<div role="status" className="p-12 text-center text-sm text-genesis-muted">Abrindo biblioteca…</div>}><FeedMediaLibraryPage /></Suspense>} />
        </Route>
        <Route path="/administracao/acessos" element={<AdminAccessLayout />}>
          <Route index element={<AccessRedirect />} />
          <Route element={<PermissionRoute permission="user.read" />}>
            <Route path="usuarios" element={<AdminUsersPage embedded />} />
          </Route>
          <Route element={<PermissionRoute permission="user.permissions.read" />}>
            <Route path="usuarios/:userId" element={<AdminUserDetailPage embedded />} />
          </Route>
          <Route element={<PermissionRoute permission="role.read" />}>
            <Route element={<PermissionRoute permission="permission.read" />}>
              <Route path="papeis" element={<AdminRolesPage embedded />} />
            </Route>
          </Route>
          <Route element={<PermissionRoute permission="user.read" />}>
            <Route element={<PermissionRoute permission="user.permissions.read" />}>
              <Route path="telas" element={<AdminScreenAccessPage />} />
            </Route>
          </Route>
        </Route>
        <Route element={<PermissionRoute permission="user.read" />}>
          <Route path="/administracao/usuarios" element={<Navigate to="/administracao/acessos/usuarios" replace />} />
        </Route>
        <Route element={<PermissionRoute permission="user.permissions.read" />}>
          <Route path="/administracao/usuarios/:userId" element={<LegacyAdminUserRedirect />} />
        </Route>
        <Route element={<PermissionRoute permission="role.read" />}>
          <Route path="/administracao/papeis" element={<Navigate to="/administracao/acessos/papeis" replace />} />
        </Route>
        <Route element={<PermissionRoute permission="permission.read" />}>
          <Route path="/administracao/permissoes" element={<Navigate to="/administracao/acessos/papeis" replace />} />
        </Route>
        <Route path="/sem-acesso" element={<PermissionRoute permission="__no_permission__" />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
