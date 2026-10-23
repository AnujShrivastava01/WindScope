import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type AnalysisQuery, type QueryParams } from '@/services/api'

const FIVE_MINUTES = 5 * 60_000

export const queryKeys = {
  meta: ['meta'] as const,
  health: ['health'] as const,
  dataHealth: ['data-health'] as const,
  overview: (q: AnalysisQuery) => ['overview', q] as const,
  summary: (q: AnalysisQuery) => ['accuracy-summary', q] as const,
  timeseries: (q: AnalysisQuery) => ['timeseries', q] as const,
  distribution: (q: AnalysisQuery) => ['distribution', q] as const,
  periods: (q: QueryParams) => ['forecast-periods', q] as const,
  vintages: (q: QueryParams) => ['forecast-vintages', q] as const,
  actuals: (q: QueryParams) => ['actuals', q] as const,
  forecasts: (q: QueryParams) => ['forecasts', q] as const,
}

export const useMeta = () =>
  useQuery({ queryKey: queryKeys.meta, queryFn: ({ signal }) => api.meta(signal), staleTime: Infinity })

export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.health(signal),
    // Poll while the initial background ingestion is still running.
    refetchInterval: (query) =>
      query.state.data?.refresh_in_progress || query.state.data?.records?.actual === 0 ? 5000 : 60_000,
  })

export const useDataHealth = () =>
  useQuery({ queryKey: queryKeys.dataHealth, queryFn: ({ signal }) => api.dataHealth(signal), staleTime: 30_000 })

export const useOverview = (q: AnalysisQuery, enabled = true) =>
  useQuery({
    queryKey: queryKeys.overview(q),
    queryFn: ({ signal }) => api.overview(q, signal),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    enabled,
  })

export const useAccuracySummary = (q: AnalysisQuery, enabled = true) =>
  useQuery({
    queryKey: queryKeys.summary(q),
    queryFn: ({ signal }) => api.accuracySummary(q, signal),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    enabled,
  })

export const useTimeseries = (q: AnalysisQuery, enabled = true) =>
  useQuery({
    queryKey: queryKeys.timeseries(q),
    queryFn: ({ signal }) => api.timeseries(q, signal),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    enabled,
  })

export const useDistribution = (q: AnalysisQuery, enabled = true) =>
  useQuery({
    queryKey: queryKeys.distribution(q),
    queryFn: ({ signal }) => api.distribution(q, signal),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    enabled,
  })

export const useForecastPeriods = (q: AnalysisQuery & QueryParams, enabled = true) =>
  useQuery({
    queryKey: queryKeys.periods(q),
    queryFn: ({ signal }) => api.forecastPeriods(q, signal),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    enabled,
  })

export const useForecastVintages = (
  q: { target_time: string; cutoff_time?: string; cutoff_days_before?: number } | null,
) =>
  useQuery({
    queryKey: queryKeys.vintages(q ?? {}),
    queryFn: ({ signal }) => api.forecastVintages(q!, signal),
    enabled: q !== null,
    staleTime: FIVE_MINUTES,
  })

export const useActuals = (q: AnalysisQuery & QueryParams, enabled = true) =>
  useQuery({
    queryKey: queryKeys.actuals(q),
    queryFn: ({ signal }) => api.actuals(q, signal),
    placeholderData: keepPreviousData,
    enabled,
  })

export const useForecastRecords = (q: AnalysisQuery & QueryParams, enabled = true) =>
  useQuery({
    queryKey: queryKeys.forecasts(q),
    queryFn: ({ signal }) => api.forecasts(q, signal),
    placeholderData: keepPreviousData,
    enabled,
  })

/** Refresh both datasets from Elexon, then invalidate every cached view. */
export function useRefreshData() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['refresh'],
    mutationFn: api.refresh,
    onSettled: () => client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'meta' }),
  })
}

export function useImportCsv() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ dataset, file }: { dataset: 'actual' | 'forecast'; file: File }) => api.importCsv(dataset, file),
    onSuccess: () => client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'meta' }),
  })
}
