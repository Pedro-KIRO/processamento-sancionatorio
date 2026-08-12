import { useEffect } from 'react'

const BASE_TITLE = 'Processamento Sancionatório — DETRAN-SP'

/** Define o document.title da página. Reseta ao desmontar. */
export function useDocumentTitle(titulo: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} | ${BASE_TITLE}` : BASE_TITLE
    return () => { document.title = BASE_TITLE }
  }, [titulo])
}
