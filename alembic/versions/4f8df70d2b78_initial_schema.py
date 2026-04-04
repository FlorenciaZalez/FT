"""initial_schema

Revision ID: 4f8df70d2b78
Revises: 
Create Date: 2026-03-19 14:10:38.302336

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f8df70d2b78'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── clients ──
    op.create_table(
        "clients",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("business_name", sa.String(200)),
        sa.Column("tax_id", sa.String(20), unique=True),
        sa.Column("contact_email", sa.String(255), nullable=False),
        sa.Column("contact_phone", sa.String(50)),
        sa.Column(
            "plan",
            sa.Enum("basic", "professional", "enterprise", name="plantype"),
            nullable=False,
            server_default="basic",
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── users ──
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "operator", "client", name="userrole"),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── products ──
    op.create_table(
        "products",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sku", sa.String(100), nullable=False, index=True),
        sa.Column("barcode", sa.String(100)),
        sa.Column("description", sa.Text),
        sa.Column("weight_kg", sa.Numeric(10, 3)),
        sa.Column("width_cm", sa.Numeric(10, 2)),
        sa.Column("height_cm", sa.Numeric(10, 2)),
        sa.Column("depth_cm", sa.Numeric(10, 2)),
        sa.Column("image_url", sa.String(500)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("client_id", "sku", name="uq_product_client_sku"),
    )

    # ── warehouse_locations ──
    op.create_table(
        "warehouse_locations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(50), unique=True, nullable=False),
        sa.Column("zone", sa.String(10), nullable=False),
        sa.Column("aisle", sa.String(10), nullable=False),
        sa.Column("shelf", sa.String(10), nullable=False),
        sa.Column("description", sa.String(255)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── stock ──
    op.create_table(
        "stock",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("location_id", sa.Integer, sa.ForeignKey("warehouse_locations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity_total", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("quantity_reserved", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column(
            "quantity_available",
            sa.Integer,
            sa.Computed("quantity_total - quantity_reserved"),
        ),
        sa.Column("min_stock_alert", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("product_id", "location_id", name="uq_stock_product_location"),
        sa.CheckConstraint("quantity_total >= 0", name="ck_stock_total_non_negative"),
        sa.CheckConstraint("quantity_reserved >= 0", name="ck_stock_reserved_non_negative"),
        sa.CheckConstraint("quantity_reserved <= quantity_total", name="ck_stock_reserved_lte_total"),
    )

    # ── orders ──
    op.create_table(
        "orders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("order_number", sa.String(50), unique=True, nullable=False, index=True),
        sa.Column(
            "source",
            sa.Enum("mercadolibre", "manual", "other", name="ordersource"),
            nullable=False,
        ),
        sa.Column("source_order_id", sa.String(100)),
        sa.Column(
            "status",
            sa.Enum("pending", "in_preparation", "prepared", "dispatched", "cancelled", name="orderstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("shipping_label_url", sa.String(500)),
        sa.Column("tracking_number", sa.String(100)),
        sa.Column("buyer_name", sa.String(200)),
        sa.Column("buyer_address", sa.Text),
        sa.Column("notes", sa.Text),
        sa.Column("assigned_operator_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("picked_at", sa.DateTime(timezone=True)),
        sa.Column("packed_at", sa.DateTime(timezone=True)),
        sa.Column("dispatched_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── order_items ──
    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("sku", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("picked_quantity", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("location_code", sa.String(50)),
    )

    # ── order_status_log ──
    op.create_table(
        "order_status_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("old_status", sa.String(30)),
        sa.Column("new_status", sa.String(30), nullable=False),
        sa.Column("changed_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── stock_movements ──
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column(
            "movement_type",
            sa.Enum("inbound", "outbound", "reservation", "reservation_release", "adjustment", name="movementtype"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column(
            "reference_type",
            sa.Enum("order", "manual", "adjustment", "inbound", name="referencetype"),
            nullable=False,
        ),
        sa.Column("reference_id", sa.Integer),
        sa.Column("performed_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
    )

    # ── alerts ──
    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), index=True),
        sa.Column(
            "alert_type",
            sa.Enum("low_stock", "no_stock", "pending_timeout", "prepared_not_dispatched", "picking_error", name="alerttype"),
            nullable=False,
        ),
        sa.Column(
            "severity",
            sa.Enum("info", "warning", "critical", name="alertseverity"),
            nullable=False,
            server_default="warning",
        ),
        sa.Column("reference_type", sa.String(50)),
        sa.Column("reference_id", sa.Integer),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("is_read", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── ml_product_mappings ──
    op.create_table(
        "ml_product_mappings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("client_id", sa.Integer, sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ml_item_id", sa.String(50), nullable=False, index=True),
        sa.Column("ml_variation_id", sa.String(50)),
        sa.Column("ml_account_id", sa.String(50)),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("client_id", "ml_item_id", "ml_variation_id", name="uq_ml_mapping_item_variation"),
    )

    # ── Row-Level Security (RLS) ──
    # Esto se ejecuta como SQL raw en PostgreSQL
    for table in ["products", "stock", "orders", "stock_movements", "alerts", "ml_product_mappings"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (client_id = current_setting('app.current_tenant')::integer)"
        )


def downgrade() -> None:
    for table in ["ml_product_mappings", "alerts", "stock_movements", "orders", "stock", "products"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("ml_product_mappings")
    op.drop_table("alerts")
    op.drop_table("stock_movements")
    op.drop_table("order_status_log")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.drop_table("stock")
    op.drop_table("warehouse_locations")
    op.drop_table("products")
    op.drop_table("users")
    op.drop_table("clients")

    # Drop enums
    for enum_name in [
        "plantype", "userrole", "ordersource", "orderstatus",
        "movementtype", "referencetype", "alerttype", "alertseverity",
    ]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
