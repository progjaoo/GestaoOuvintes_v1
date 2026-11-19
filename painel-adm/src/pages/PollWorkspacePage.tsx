import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/shadcn/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/shadcn/tabs";
import { PollResultsPanel } from "@/components/polls/PollResultsPanel";
import { PollParticipations } from "@/pages/ProgramParticipationsPage";
import { PollError } from "@/components/polls/PollFeedback";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";

export function PollWorkspacePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  usePageTitle("Resultados e mensagens");
  const canResults = hasPermission(user, "poll.results.read");
  const canMessages = hasPermission(user, "participation.read");
  if (!user || (!canResults && !canMessages))
    return (
      <main>
        <h1>Acesso não autorizado</h1>
        <p>Seu perfil não possui acesso a resultados ou mensagens.</p>
      </main>
    );
  return (
    <AppShell>
      <Workspace
        key={`${user.id}:${id}`}
        id={id}
        canResults={canResults}
        canMessages={canMessages}
      />
    </AppShell>
  );
}
function Workspace({
  id,
  canResults,
  canMessages,
}: {
  id: string;
  canResults: boolean;
  canMessages: boolean;
}) {
  const { user } = useAuth();
  const [selected, setSelected] = useState(canResults ? "results" : "messages");
  const tab =
    (selected === "results" && canResults) ||
    (selected === "messages" && canMessages)
      ? selected
      : canResults
        ? "results"
        : "messages";
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {hasPermission(user, "poll.read") ? (
        <AuthorizedHeading id={id} />
      ) : (
        <WorkspaceHeading id={id} />
      )}
      <Tabs value={tab} onValueChange={setSelected} className="min-w-0">
        <TabsList aria-label="Áreas da enquete">
          {canResults && <TabsTrigger value="results">Resultados</TabsTrigger>}
          {canMessages && <TabsTrigger value="messages">Mensagens</TabsTrigger>}
        </TabsList>
        {canResults && (
          <TabsContent value="results">
            {tab === "results" && <PollResultsPanel id={id} />}
          </TabsContent>
        )}
        {canMessages && (
          <TabsContent value="messages">
            {tab === "messages" && <PollParticipations pollId={id} />}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AuthorizedHeading({ id }: { id: string }) {
  const poll = useQuery({
    queryKey: ["polls", "detail", id],
    queryFn: () => api.getPoll(id),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <>
      <WorkspaceHeading
        id={id}
        question={poll.data?.question}
        programName={poll.data?.programName}
        canRead
      />
      {poll.isError && <PollError error={poll.error} />}
    </>
  );
}
function WorkspaceHeading({
  id,
  question,
  programName,
  canRead = false,
}: {
  id: string;
  question?: string;
  programName?: string;
  canRead?: boolean;
}) {
  return (
    <PageHeader
      eyebrow="Operação / Enquetes"
      title={question ?? "Resultados e mensagens"}
      description={
        programName ?? "Consulte votos e mensagens privadas desta enquete."
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/enquetes">Voltar às enquetes</Link>
          </Button>
          {canRead && (
            <Button variant="outline" asChild>
              <Link to={`/enquetes/${id}`}>Abrir cadastro</Link>
            </Button>
          )}
        </div>
      }
    />
  );
}
