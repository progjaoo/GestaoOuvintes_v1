import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { PrivateArticlePreview } from "./FeedEditorPage";
import { Button } from "@/components/ui/Button";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { FeedPreviewData } from "@/services/feed-preview-channel";

export function FeedPreviewPage() {
  const { token } = useParams();
  const [data, setData] = useState<FeedPreviewData | null>(null);
  const [mobile, setMobile] = useState(false);
  usePageTitle("Prévia privada do Feed");
  useEffect(() => {
    if (!token || !/^[\da-f-]{36}$/i.test(token)) return;
    const channel = new BroadcastChannel(`feed-preview:${token}`);
    channel.onmessage = (event: MessageEvent<FeedPreviewData>) => {
      if (event.data?.revision && Array.isArray(event.data.categories)) setData(event.data);
    };
    channel.postMessage("ready");
    return () => channel.close();
  }, [token]);
  return <main className="min-h-screen bg-neutral-100">
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
      <div><h1 className="font-bold">Prévia privada do Feed</h1><p className="text-xs text-genesis-muted">Não publica nem salva alterações. Volte ao editor para continuar.</p></div>
      <div className="flex gap-2"><Button variant={mobile ? "outline" : "primary"} onClick={() => setMobile(false)}>Desktop</Button><Button variant={mobile ? "primary" : "outline"} onClick={() => setMobile(true)}>Mobile</Button></div>
    </header>
    {data ? <div className={`mx-auto bg-white ${mobile ? "max-w-[390px]" : "max-w-[1280px]"}`}><PrivateArticlePreview revision={data.revision} categories={data.categories} /></div> : <p role="status" className="mx-auto max-w-lg p-12 text-center">Aguardando o editor. Se a prévia expirou ou o editor foi fechado, abra novamente pelo botão Pré-visualizar da matéria.</p>}
  </main>;
}
