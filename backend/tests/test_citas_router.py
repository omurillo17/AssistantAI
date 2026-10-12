from datetime import datetime
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo
import pytest

from app.routers import citas


@pytest.mark.asyncio
async def test_google_calendar_endpoint_returns_events():
    mock_pool = AsyncMock()
    mock_pool.fetch.return_value = [{"calendar_id": "recruiter1@gmail.com"}]

    mock_events = [
        {"id": "evt1", "summary": "🔒 Bloqueo de Horario", "start": {"dateTime": "2026-10-07T10:00:00-06:00"}},
        {"id": "evt2", "summary": "Juan Perez - Operador", "start": {"dateTime": "2026-10-07T11:00:00-06:00"}},
    ]

    with patch("app.routers.citas.get_pool", return_value=mock_pool), \
         patch("app.routers.citas.list_events", new_callable=AsyncMock) as mock_list_events:
        mock_list_events.return_value = mock_events

        start = datetime(2026, 10, 1, 0, 0, 0)
        end = datetime(2026, 10, 31, 23, 59, 59)

        result = await citas.google_calendar(start=start, end=end)

        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]["id"] == "evt1"
        assert result[0]["calendarId"] == "recruiter1@gmail.com"
        assert result[1]["calendarId"] == "recruiter1@gmail.com"

        # Verify timezones were attached
        call_args = mock_list_events.call_args[0]
        assert call_args[0] == "recruiter1@gmail.com"
        assert call_args[1].tzinfo == ZoneInfo("America/Mexico_City")
        assert call_args[2].tzinfo == ZoneInfo("America/Mexico_City")


@pytest.mark.asyncio
async def test_cancelar_bloqueo():
    mock_pool = AsyncMock()
    mock_pool.fetchrow.return_value = None

    with patch("app.routers.citas.get_pool", return_value=mock_pool), \
         patch("app.routers.citas.delete_event", new_callable=AsyncMock) as mock_delete:
        
        req = citas.CancelarCitaRequest(
            telefono="No registrado",
            event_id="evt_block_123",
            calendar_id="recruiter1@gmail.com",
            motivo="",
        )
        res = await citas.cancelar(req)

        assert res["success"] is True
        mock_delete.assert_awaited_once_with(
            calendar_id="recruiter1@gmail.com",
            event_id="evt_block_123",
        )
        # Verify no message enqueued to cola_mensajes
        for call in mock_pool.execute.call_args_list:
            assert "INSERT INTO cola_mensajes" not in call[0][0]

