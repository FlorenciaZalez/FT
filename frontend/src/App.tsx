import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './routes/ProtectedRoute'
import DashboardLayout from './layouts/DashboardLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import ClientEdit from './pages/ClientEdit'
import Products from './pages/Products'
import Stock from './pages/Stock'
import Users from './pages/Users'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Batches from './pages/Batches'
import BatchDetail from './pages/BatchDetail'
import Picking from './pages/Picking'
import PickingSession from './pages/PickingSession'
import BatchPickingCollect from './pages/BatchPickingCollect'
import BatchPickingSession from './pages/BatchPickingSession'
import DispatchSession from './pages/DispatchSession'
import Locations from './pages/Locations'
import Alerts from './pages/Alerts'
import Transporters from './pages/Transporters'
import DispatchVerify from './pages/DispatchVerify'
import MercadoLibreCallback from './pages/MercadoLibreCallback'
import Billing from './pages/Billing'
import BillingHistory from './pages/BillingHistory'
import ShippingRules from './pages/ShippingRules'
import MercadoLibreMappings from './pages/MercadoLibreMappings'
import Returns from './pages/Returns'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dispatch/verify/:batchNumber" element={<DispatchVerify />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/clients/:id/edit" element={<ClientEdit />} />
          <Route path="/products" element={<Products />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/users" element={<Users />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/batches" element={<Batches />} />
          <Route path="/batches/:id" element={<BatchDetail />} />
          <Route path="/picking" element={<Picking />} />
          <Route path="/picking/batch/:sessionId" element={<BatchPickingCollect />} />
          <Route path="/picking/batch/:sessionId/validate" element={<BatchPickingSession />} />
          <Route path="/picking/:orderId" element={<PickingSession />} />
          <Route path="/dispatch" element={<DispatchSession />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/transporters" element={<Transporters />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/billing/history" element={<BillingHistory />} />
          <Route path="/shipping-rules" element={<ShippingRules />} />
          <Route path="/integrations/ml/mappings" element={<MercadoLibreMappings />} />
          <Route path="/integrations/ml/callback" element={<MercadoLibreCallback />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
