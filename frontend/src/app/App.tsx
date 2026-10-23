import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import { AppLayout } from '@/components/layout/AppLayout'
import { LoadingBlock } from '@/components/ui/feedback'
import { ApiError } from '@/services/api'

const Landing = lazy(() => import('@/pages/Landing'))
const Overview = lazy(() => import('@/pages/Overview'))
const ForecastAnalysis = lazy(() => import('@/pages/ForecastAnalysis'))
const ForecastAccuracy = lazy(() => import('@/pages/ForecastAccuracy'))
const HistoricalData = lazy(() => import('@/pages/HistoricalData'))
const DataHealth = lazy(() => import('@/pages/DataHealth'))
const Methodology = lazy(() => import('@/pages/Methodology'))
const NotFound = lazy(() => import('@/pages/NotFound'))

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // Retry transient failures, but not client errors such as validation problems.
        retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
      },
    },
  })
}

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingBlock className="p-6" />}>
      <Routes>
        <Route index element={<Landing />} />
        <Route element={<AppLayout />}>
          <Route path="overview" element={<Overview />} />
          <Route path="forecast-analysis" element={<ForecastAnalysis />} />
          <Route path="forecast-accuracy" element={<ForecastAccuracy />} />
          <Route path="historical-data" element={<HistoricalData />} />
          <Route path="data-health" element={<DataHealth />} />
          <Route path="methodology" element={<Methodology />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  )
}
