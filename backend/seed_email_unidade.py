"""Seed: popula config_email_unidade com os emails das unidades sancionatórias."""
from dotenv import load_dotenv
load_dotenv()

from app.db.base import get_engine, get_sessionmaker
from app.db import models as m

engine = get_engine()
m.Base.metadata.create_all(engine)
Session = get_sessionmaker(engine)
s = Session()

# Limpar dados antigos
s.query(m.ConfigEmailUnidade).delete()
s.commit()

# Inserir mapeamentos (id_unidade, agente_regulado, email, descricao)
dados = [
    ("110053117", "ECV/EPIV", "sancionatorio.ecv.piv@detran.sp.gov.br", "Sancionatorio ECV e PIV"),
    ("110051042", "Autoescola", "sancionatorio.cfc@detran.sp.gov.br", "Sancionatorio CFC"),
    ("110051043", "Instituicoes de ensino", "sancionatorio.educacao@detran.sp.gov.br", "Sancionatorio Educacao"),
    ("110051044", "Desmontes", "sancionatorio.desmontes@detran.sp.gov.br", "Sancionatorio Desmontes"),
    ("110051045", "Peritos", "sancionatorio.peritos@detran.sp.gov.br", "Sancionatorio Peritos"),
    ("110053119", "Despachantes/Patios", "sancionatorio.administrativas@detran.sp.gov.br", "Sancionatorio Administrativas"),
]

for id_unidade, agente, email, desc in dados:
    s.add(m.ConfigEmailUnidade(id_unidade=id_unidade, agente_regulado=agente, email=email, descricao=desc))

s.commit()
print(f"OK - {len(dados)} registros inseridos")

# Verificar
rows = s.query(m.ConfigEmailUnidade).all()
for r in rows:
    print(f"  {r.id_unidade} | {r.agente_regulado} | {r.email}")
