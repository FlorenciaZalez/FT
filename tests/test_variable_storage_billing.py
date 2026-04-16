import unittest
from decimal import Decimal

from app.billing import service


class VariableStorageBillingTests(unittest.TestCase):
    def test_daily_variable_storage_prorates_monthly_rate(self) -> None:
        amount = service._calculate_storage_amount_from_daily_volumes(
            daily_volumes=[Decimal("2.000")] * 10 + [Decimal("1.000")] * 20,
            storage_rate=Decimal("3000.00"),
            days_in_month=30,
        )

        self.assertEqual(amount, Decimal("4000.00"))


if __name__ == "__main__":
    unittest.main()
