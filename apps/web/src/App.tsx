import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { SeiLinkGuard } from './components/SeiLinkGuard'
import { HomePage } from './features/home/HomePage'
import { CaixaEntradaPage } from './features/caixaEntrada/CaixaEntradaPage'
import { AnaliseRelatorioPage } from './features/analise/AnaliseRelatorioPage'
import { ProcessosAndamentoPage } from './features/processosAndamento/ProcessosAndamentoPage'
import { AnaliseProcessoPage } from './features/processosAndamento/AnaliseProcessoPage'
import { ConsultaUnificadaPage } from './features/consultaUnificada/ConsultaUnificadaPage'
import { CautelaresPage } from './features/cautelares/CautelaresPage'
import { PrazosPage } from './features/prazos/PrazosPage'
import { TextosPadroesPage } from './features/textosPadroes/TextosPadroesPage'
import { AdvogadosPage } from './features/advogados/AdvogadosPage'
import { BibliotecaPage } from './features/biblioteca/BibliotecaPage'
import { UsuariosPage } from './features/usuarios/UsuariosPage'
import { NotFoundPage } from './features/NotFoundPage'

export default function App() {
  return (
    <SeiLinkGuard>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="caixa-entrada" element={<CaixaEntradaPage />} />
          <Route path="analise/:id" element={<AnaliseRelatorioPage />} />
          <Route path="processos" element={<ProcessosAndamentoPage />} />
          <Route path="processos/:id" element={<AnaliseProcessoPage />} />
          <Route path="consulta-unificada" element={<ConsultaUnificadaPage />} />
          <Route path="prazos" element={<PrazosPage />} />
          <Route path="cautelares" element={<CautelaresPage />} />
          <Route path="textos-padroes" element={<TextosPadroesPage />} />
          <Route path="advogados" element={<AdvogadosPage />} />
          <Route path="biblioteca" element={<BibliotecaPage />} />
          <Route path="usuarios" element={<UsuariosPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </SeiLinkGuard>
  )
}
