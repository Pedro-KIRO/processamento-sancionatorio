"""Testes do cliente Graph (sem rede: sessão e token mockados)."""
from unittest.mock import MagicMock

from app.integrations.graph import GraphClient, GraphSettings


def make_settings() -> GraphSettings:
    return GraphSettings(
        tenant_id="t",
        client_id="c",
        client_secret="s",
        hostname="governosp.sharepoint.com",
        site_path="/teams/DETRAN-CPSAR",
    )


def _resp(json_data):
    r = MagicMock()
    r.json.return_value = json_data
    r.raise_for_status.return_value = None
    return r


def test_get_site_id_usa_token_e_url_corretos():
    s = MagicMock()
    s.get.return_value = _resp({"id": "site-123"})
    cli = GraphClient(make_settings(), session=s, get_token=lambda: "tok")

    site_id = cli.get_site_id()

    assert site_id == "site-123"
    args, kwargs = s.get.call_args
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert args[0].endswith("governosp.sharepoint.com:/teams/DETRAN-CPSAR")


def test_iter_itens_segue_paginacao():
    s = MagicMock()
    pagina1 = _resp({"value": [{"fields": {"Title": "A"}}], "@odata.nextLink": "https://next"})
    pagina2 = _resp({"value": [{"fields": {"Title": "B"}}]})
    s.get.side_effect = [pagina1, pagina2]
    cli = GraphClient(make_settings(), session=s, get_token=lambda: "tok")

    itens = list(cli.iter_itens("site-123", "list-1"))

    assert [i["Title"] for i in itens] == ["A", "B"]
    assert s.get.call_count == 2
