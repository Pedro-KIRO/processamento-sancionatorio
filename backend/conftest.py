import os
import sys

# Garante que o pacote "app" seja importável ao rodar os testes,
# independentemente de como o pytest for invocado.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
