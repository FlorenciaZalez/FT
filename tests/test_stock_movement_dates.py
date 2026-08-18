import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import app.models  # noqa: F401
from app.stock import service as stock_service
from app.stock.movement_models import MovementType, ReferenceType


class _FakeDb:
    def __init__(self) -> None:
        self.flush = AsyncMock()
        self.refresh = AsyncMock()
        self.get = AsyncMock()
        self.added = []

    def add(self, value) -> None:
        self.added.append(value)


class StockMovementDateTests(unittest.IsolatedAsyncioTestCase):
    async def test_record_movement_uses_manual_date_at_noon_utc(self) -> None:
        db = _FakeDb()

        movement = await stock_service._record_movement(
            db,
            client_id=7,
            product_id=11,
            movement_type=MovementType.inbound,
            quantity=4,
            reference_type=ReferenceType.inbound,
            user_id=3,
            notes="Ingreso retroactivo",
            movement_date=date(2026, 8, 14),
        )

        self.assertIs(db.added[0], movement)
        self.assertEqual(movement.created_at, datetime(2026, 8, 14, 12, tzinfo=timezone.utc))

    async def test_simple_inbound_forwards_manual_movement_date(self) -> None:
        db = _FakeDb()
        user = SimpleNamespace(id=9)
        product = SimpleNamespace(id=11, client_id=7, name="Producto demo", sku="SKU-11")
        stock = SimpleNamespace(quantity_total=3)
        db.get.return_value = product

        with (
            patch("app.stock.service.check_tenant_access"),
            patch("app.stock.service._ensure_product_storage_volume"),
            patch("app.stock.service._get_default_location", AsyncMock(return_value=SimpleNamespace(id=5))),
            patch("app.stock.service._get_or_create_stock", AsyncMock(return_value=stock)),
            patch("app.stock.service._record_movement", AsyncMock()) as record_movement,
            patch("app.stock.service.check_stock_after_change", AsyncMock()),
        ):
            result = await stock_service.simple_inbound(
                db,
                user,
                product_id=11,
                quantity=2,
                reason="Carga tardía",
                movement_date=date(2026, 8, 10),
            )

        record_movement.assert_awaited_once_with(
            db,
            7,
            11,
            MovementType.inbound,
            2,
            ReferenceType.inbound,
            user_id=9,
            notes="Carga tardía",
            movement_date=date(2026, 8, 10),
        )
        self.assertEqual(result["new_quantity"], 5)
