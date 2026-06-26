import { api } from '../../../lib/api'
import type {
  Metric,
  KPI,
  MetricListResponse,
  KPIListResponse,
  KPIDetailResponse,
  CreateKPIPayload,
  UpdateKPIPayload,
} from '../types/metric'

export const metricsApi = {
  /**
   * GET /v1/metrics
   */
  list: async (): Promise<MetricListResponse> => {
    const response = await api.get<MetricListResponse>('/metrics')
    return response.data
  },

  /**
   * GET /v1/metrics/:name/history
   */
  getHistory: async (name: string): Promise<{ data: Metric[] }> => {
    const response = await api.get<{ data: Metric[] }>(`/metrics/${name}/history`)
    return response.data
  },

  /**
   * GET /v1/kpis
   */
  listKPIs: async (): Promise<KPIListResponse> => {
    const response = await api.get<KPIListResponse>('/kpis')
    return response.data
  },

  /**
   * GET /v1/kpis/:id
   */
  getKPI: async (id: string): Promise<KPIDetailResponse> => {
    const response = await api.get<KPIDetailResponse>(`/kpis/${id}`)
    return response.data
  },

  /**
   * POST /v1/kpis
   */
  createKPI: async (payload: CreateKPIPayload): Promise<KPIDetailResponse> => {
    const response = await api.post<KPIDetailResponse>('/kpis', payload)
    return response.data
  },

  /**
   * PATCH /v1/kpis/:id
   */
  updateKPI: async (id: string, payload: UpdateKPIPayload): Promise<KPIDetailResponse> => {
    const response = await api.patch<KPIDetailResponse>(`/kpis/${id}`, payload)
    return response.data
  },

  /**
   * DELETE /v1/kpis/:id
   */
  deleteKPI: async (id: string): Promise<void> => {
    await api.delete(`/kpis/${id}`)
  },
}
