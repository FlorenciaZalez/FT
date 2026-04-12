import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './routes/ProtectedRoute'
import DashboardLayout from './layouts/DashboardLayout'

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientDetail = lazy(() => import('./pages/ClientDetail'))
const ClientEdit = lazy(() => import('./pages/ClientEdit'))
const Products = lazy(() => import('./pages/Products'))
const Stock = lazy(() => import('./pages/Stock'))
const Users = lazy(() => import('./pages/Users'))
const Orders = lazy(() => import('./pages/Orders'))
const OrderDetail = lazy(() => import('./pages/OrderDetail'))
const Batches = lazy(() => import('./pages/Batches'))
const BatchDetail = lazy(() => import('./pages/BatchDetail'))
const Picking = lazy(() => import('./pages/Picking'))
const PickingSession = lazy(() => import('./pages/PickingSession'))
const BatchPickingCollect = lazy(() => import('./pages/BatchPickingCollect'))
const BatchPickingSession = lazy(() => import('./pages/BatchPickingSession'))
const DispatchSession = lazy(() => import('./pages/DispatchSession'))
const Locations = lazy(() => import('./pages/Locations'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Transporters = lazy(() => import('./pages/Transporters'))
const DispatchVerify = lazy(() => import('./pages/DispatchVerify'))
const MercadoLibreCallback = lazy(() => import('./pages/MercadoLibreCallback'))
const Billing = lazy(() => import('./pages/Billing'))
const BillingHistory = lazy(() => import('./pages/BillingHistory'))
const ShippingRules = lazy(() => import('./pages/ShippingRules'))
const MercadoLibreMappings = lazy(() => import('./pages/MercadoLibreMappings'))
const Returns = lazy(() => import('./pages/Returns'))

function App() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-gray-50"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>}>
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
    </Suspense>
  )
}

export default App
