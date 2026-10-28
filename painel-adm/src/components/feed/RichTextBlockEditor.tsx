import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Strikethrough, Undo2, Redo2 } from "lucide-react";
import type { EditorialTextBlock } from "@/types/feed";

const extensions = [StarterKit.configure({
  heading: { levels: [2, 3] },
  code: false,
  codeBlock: false,
  hardBreak: false,
  underline: false,
})];

export function RichTextBlockEditor({
  value,
  onChange,
}: {
  value: EditorialTextBlock["content"];
  onChange: (content: EditorialTextBlock["content"]) => void;
}) {
  const editor = useEditor({
    extensions,
    content: value,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "feed-rich-editor",
        "aria-label": "Texto da matéria",
      },
    },
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getJSON() as EditorialTextBlock["content"]),
  });

  if (!editor) return <div className="min-h-40 animate-pulse rounded-lg bg-neutral-100" />;

  const controls = [
    { label: "Negrito", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Itálico", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Tachado", icon: Strikethrough, active: editor.isActive("strike"), run: () => editor.chain().focus().toggleStrike().run() },
    { label: "Título de seção", icon: Heading2, active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Subtítulo", icon: Heading3, active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Lista", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Lista numerada", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Citação", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  const addLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const entered = window.prompt("URL do link (https://, http:// ou mailto:)", current ?? "https://");
    if (entered === null) return;
    try {
      const url = new URL(entered);
      if (!["https:", "http:", "mailto:"].includes(url.protocol)) throw new Error();
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.href }).run();
    } catch {
      window.alert("Informe um link http, https ou mailto válido.");
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-genesis-border bg-white">
      <div role="toolbar" aria-label="Formatação do texto" className="flex flex-wrap items-center gap-1 border-b border-genesis-border bg-neutral-50 p-2">
        {controls.map(({ label, icon: Icon, active, run }) => (
          <button key={label} type="button" aria-label={label} aria-pressed={active} onClick={run} className={`grid h-9 w-9 place-items-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-genesis-primary ${active ? "bg-genesis-primary text-white" : "text-genesis-muted hover:bg-white hover:text-genesis-text"}`}>
            <Icon size={17} aria-hidden="true" />
          </button>
        ))}
        <button type="button" aria-label="Inserir link" onClick={addLink} className="grid h-9 w-9 place-items-center rounded-md text-genesis-muted hover:bg-white hover:text-genesis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-genesis-primary"><Link2 size={17} /></button>
        <span className="mx-1 h-6 border-l border-genesis-border" aria-hidden="true" />
        <button type="button" aria-label="Desfazer" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} className="grid h-9 w-9 place-items-center rounded-md text-genesis-muted hover:bg-white disabled:opacity-40"><Undo2 size={17} /></button>
        <button type="button" aria-label="Refazer" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} className="grid h-9 w-9 place-items-center rounded-md text-genesis-muted hover:bg-white disabled:opacity-40"><Redo2 size={17} /></button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
