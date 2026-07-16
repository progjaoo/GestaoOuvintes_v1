import { useEffect } from "react";

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | Cadastros Rádio 88`;
  }, [title]);
}
