import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.orders import service as order_service
from app.orders.models import OrderOperationType, OrderStatus


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, execute_results=None):
        self.execute = AsyncMock(side_effect=execute_results or [])
        self.flush = AsyncMock()
        self.refresh = AsyncMock()
        self.added = []

    def add(self, value):
        if getattr(value, "id", None) is None:
            value.id = 123
        self.added.append(value)


class OrderServiceRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_prepared_order_removes_preparation_record(self) -> None:
        order = SimpleNamespace(
            id=99,
            status=OrderStatus.prepared,
            operation_type=OrderOperationType.sale,
            items=[SimpleNamespace(product_id=5, quantity=2)],
            client_id=7,
            client=SimpleNamespace(name="Cliente"),
            cancelled_at=None,
        )
        user = SimpleNamespace(id=11)
        db = _FakeDb(execute_results=[None])

        with (
            patch("app.orders.service._get_order", AsyncMock(return_value=order)),
            patch("app.orders.service._ensure_order_not_in_active_batch_session", AsyncMock()),
            patch("app.orders.service._log_status_change", AsyncMock()),
            patch("app.orders.service._serialize_order", return_value={"id": order.id}),
            patch("app.orders.service.stock_service.release_stock", AsyncMock()),
        ):
            await order_service.cancel_order(db, order.id, user)

        delete_stmt = db.execute.await_args_list[0].args[0]
        self.assertIn("DELETE FROM preparation_records", str(delete_stmt))
        self.assertEqual(delete_stmt.compile().params["order_id_1"], order.id)

    async def test_batch_dispatch_aggregates_transport_records_per_client(self) -> None:
        user = SimpleNamespace(id=17)
        orders = [
            SimpleNamespace(
                id=1,
                client_id=4,
                status=OrderStatus.prepared,
                client=SimpleNamespace(name="Cliente A"),
            ),
            SimpleNamespace(
                id=2,
                client_id=4,
                status=OrderStatus.prepared,
                client=SimpleNamespace(name="Cliente A"),
            ),
            SimpleNamespace(
                id=3,
                client_id=9,
                status=OrderStatus.prepared,
                client=SimpleNamespace(name="Cliente B"),
            ),
        ]
        db = _FakeDb(execute_results=[_ScalarResult(orders), _ScalarResult(orders)])

        with (
            patch("app.orders.service._expand_exchange_order_ids", AsyncMock(return_value=[1, 2, 3])),
            patch("app.orders.service._next_batch_number", AsyncMock(return_value="DESP-00001")),
            patch("app.orders.service._dispatch_order_in_batch", AsyncMock()),
            patch("app.orders.service.record_transport_dispatch", AsyncMock()) as record_transport_dispatch,
            patch("app.orders.service.check_tenant_access"),
            patch("app.orders.service._serialize_order", side_effect=lambda order, _: {"id": order.id}),
        ):
            result = await order_service.batch_dispatch(
                db,
                user,
                order_ids=[1, 2, 3],
                carrier="Carrier",
                register_transport_transfer=True,
            )

        self.assertEqual(result["order_count"], 3)
        self.assertEqual(record_transport_dispatch.await_count, 2)

        calls_by_client = {
            call.kwargs["client_id"]: call.kwargs["cantidad_pedidos"]
            for call in record_transport_dispatch.await_args_list
        }
        self.assertEqual(calls_by_client[4], 2)
        self.assertEqual(calls_by_client[9], 1)


if __name__ == "__main__":
    unittest.main()