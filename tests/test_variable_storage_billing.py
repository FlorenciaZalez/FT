import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import app.models  # noqa: F401
from app.billing import service
from app.common.exceptions import BadRequestError


class VariableStorageBillingTests(unittest.TestCase):
    def test_accumulated_storage_volume_sums_daily_volumes(self) -> None:
        accumulated = service._accumulate_storage_volume_for_daily_volumes(
            daily_volumes=[Decimal("2.000")] * 10 + [Decimal("1.000")] * 20,
        )

        self.assertEqual(accumulated, Decimal("40.000"))

    def test_daily_variable_storage_prorates_monthly_rate(self) -> None:
        amount = service._calculate_storage_amount_from_daily_volumes(
            daily_volumes=[Decimal("2.000")] * 10 + [Decimal("1.000")] * 20,
            storage_rate=Decimal("3000.00"),
            days_in_month=30,
        )

        self.assertEqual(amount, Decimal("4000.00"))

    def test_rewind_quantities_ignores_post_period_movements(self) -> None:
        state = service._rewind_quantities_to_day(
            current_quantities={1: 5},
            movement_rows=[
                {
                    "product_id": 1,
                    "quantity": 5,
                    "created_at": datetime(2026, 7, 2, tzinfo=timezone.utc),
                }
            ],
            end_day=date(2026, 6, 30),
        )

        self.assertEqual(state[1], 0)


class VariableStorageBillingAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_single_document_only_checks_target_client_missing_storage(self) -> None:
        ok_preview = SimpleNamespace(
            client=SimpleNamespace(id=9, name="Nicolas Luvara"),
            accumulated_m3=Decimal("32.485"),
            storage_amount=Decimal("12000.00"),
            preparation_amount=Decimal("0.00"),
            product_creation_amount=Decimal("354.00"),
            label_print_amount=Decimal("711.00"),
            transport_dispatch_amount=Decimal("0.00"),
            truck_unloading_amount=Decimal("0.00"),
            manual_charge_amount=Decimal("0.00"),
            shipping_amount=Decimal("0.00"),
            total=Decimal("13065.00"),
            missing_storage=False,
        )
        missing_preview = SimpleNamespace(
            client=SimpleNamespace(id=2, name="Emilio Mazzucotelli"),
            missing_storage=True,
        )

        empty_scalars = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
        db = SimpleNamespace(
            execute=AsyncMock(side_effect=[empty_scalars, empty_scalars]),
            flush=AsyncMock(),
            refresh=AsyncMock(),
            get=AsyncMock(return_value=SimpleNamespace(id=9, name="Nicolas Luvara")),
            add=lambda value: None,
        )

        with (
            patch("app.billing.service._ensure_historical_billing_records", AsyncMock()),
            patch("app.billing.service._build_preview_rows", AsyncMock(return_value=[missing_preview, ok_preview])),
            patch("app.billing.service._calculate_due_date", return_value=date(2026, 7, 4)),
            patch("app.billing.service.date") as mocked_date,
        ):
            mocked_date.today.return_value = date(2026, 7, 5)
            mocked_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)
            documents = await service.generate_billing_documents(db, "2026-06", overwrite=True, client_id=9)

        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0].client_id, 9)
        self.assertEqual(documents[0].storage_total, Decimal("12000.00"))

    async def test_historical_period_ignores_invalid_stock_added_after_month_end(self) -> None:
        quantity_rows = SimpleNamespace(all=lambda: [(1, 5, None, None, None, None)])
        movement_rows = SimpleNamespace(
            all=lambda: [
                (1, 5, datetime(2026, 7, 2, tzinfo=timezone.utc), None, None, None, None),
            ]
        )
        db = SimpleNamespace(execute=AsyncMock(side_effect=[quantity_rows, movement_rows]))

        fake_now = datetime(2026, 7, 5, tzinfo=timezone.utc)
        fixed_datetime = type(
            "FixedDateTime",
            (datetime,),
            {"now": classmethod(lambda cls, _tz=None: fake_now)},
        )
        with patch("app.billing.service.datetime", fixed_datetime):
            current_total_m3, daily_rows, missing = await service._build_variable_storage_daily_rows(db, 9, "2026-06")

        self.assertEqual(current_total_m3, Decimal("0.000"))
        self.assertFalse(missing)
        self.assertEqual(len(daily_rows), 30)
        self.assertTrue(all(volume == Decimal("0.000") for _, volume in daily_rows))

    async def test_storage_daily_report_prefers_manual_record_override(self) -> None:
        client = SimpleNamespace(id=7, name="Cliente Demo", variable_storage_enabled=True)
        user = SimpleNamespace(id=1)
        global_rates = SimpleNamespace(storage_per_m3=Decimal("3000.00"))
        storage_record = SimpleNamespace(storage_m3=Decimal("3.000"))
        db = SimpleNamespace(
            get=AsyncMock(return_value=client),
            execute=AsyncMock(
                side_effect=[
                    SimpleNamespace(scalar_one_or_none=lambda: None),
                    SimpleNamespace(scalar_one_or_none=lambda: storage_record),
                ]
            ),
        )

        with (
            patch("app.billing.service.check_tenant_access"),
            patch("app.billing.service._get_or_create_global_rates", AsyncMock(return_value=global_rates)),
            patch("app.billing.service._build_variable_storage_daily_rows", AsyncMock()) as build_daily_rows,
        ):
            report = await service.get_storage_daily_report(db, user, client.id, "2026-07")

        build_daily_rows.assert_not_awaited()
        self.assertEqual(report["current_m3"], 3.0)
        self.assertEqual(report["storage_total"], 9000.0)
        self.assertEqual(len(report["rows"]), 31)
        self.assertAlmostEqual(sum(row["amount"] for row in report["rows"]), 9000.0, places=2)

    async def test_storage_daily_report_falls_back_to_variable_when_manual_record_missing(self) -> None:
        client = SimpleNamespace(id=7, name="Cliente Demo", variable_storage_enabled=False)
        user = SimpleNamespace(id=1)
        global_rates = SimpleNamespace(storage_per_m3=Decimal("3000.00"))
        db = SimpleNamespace(
            get=AsyncMock(return_value=client),
            execute=AsyncMock(
                side_effect=[
                    SimpleNamespace(scalar_one_or_none=lambda: None),
                    SimpleNamespace(scalar_one_or_none=lambda: None),
                ]
            ),
        )

        with (
            patch("app.billing.service.check_tenant_access"),
            patch("app.billing.service._get_or_create_global_rates", AsyncMock(return_value=global_rates)),
            patch(
                "app.billing.service._build_variable_storage_daily_rows",
                AsyncMock(
                    return_value=(
                        Decimal("2.500"),
                        [
                            (date(2026, 7, 1), Decimal("2.500")),
                            (date(2026, 7, 2), Decimal("2.500")),
                        ],
                        False,
                    )
                ),
            ) as build_daily_rows,
        ):
            report = await service.get_storage_daily_report(db, user, client.id, "2026-07")

        build_daily_rows.assert_awaited_once_with(db, client.id, "2026-07")
        self.assertEqual(report["current_m3"], 2.5)
        self.assertEqual(report["storage_total"], 483.88)
        self.assertEqual(len(report["rows"]), 2)

    async def test_manual_storage_record_overrides_variable_missing_storage_in_preview(self) -> None:
        storage_record = SimpleNamespace(client_id=9, storage_m3=Decimal("1.500"))

        with patch("app.billing.service._calculate_storage_metrics_from_record") as calc_from_record:
            calc_from_record.return_value = (Decimal("1.500"), Decimal("1.500"), Decimal("4500.00"), False)
            result = calc_from_record(storage_record, Decimal("3000.00"))

        self.assertEqual(result, (Decimal("1.500"), Decimal("1.500"), Decimal("4500.00"), False))

    async def test_generate_billing_documents_rejects_missing_storage(self) -> None:
        preview = SimpleNamespace(
            client=SimpleNamespace(id=9, name="Nicolas Luvara"),
            missing_storage=True,
        )

        with (
            patch("app.billing.service._ensure_historical_billing_records", AsyncMock()),
            patch("app.billing.service._build_preview_rows", AsyncMock(return_value=[preview])),
        ):
            with self.assertRaises(BadRequestError) as ctx:
                await service.generate_billing_documents(SimpleNamespace(), "2026-07", overwrite=True, client_id=9)

        self.assertEqual(
            str(ctx.exception),
            "Faltan datos de almacenamiento para: Nicolas Luvara",
        )


if __name__ == "__main__":
    unittest.main()
