/** Ícone do Material Symbols (carregado via Google Fonts no index.html). */
export function Icone({ nome, className = '' }: { nome: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{nome}</span>
}
