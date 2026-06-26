// Metric and KPI types — mirrors backend domain

export interface Metric {
  id: string
  organizationId: string
  name: string
  currentValue: number
  computedAt: string
}

export interface KPI {
  id: string
  organizationId: string
  name: string
  metricName: string
  operator: '>' | '<' | '>=' | '<=' | '='
  targetValue: number
  currentValue: number
  isBreached: boolean
  ownerUserId: string
  createdAt: string
}

export interface CreateKPIPayload {
  name: string
  metricName: string
  operator: '>' | '<' | '>=' | '<=' | '='
  targetValue: number
  ownerUserId: string
}

export interface UpdateKPIPayload {
  name?: string
  metricName?: string
  operator?: '>' | '<' | '>=' | '<=' | '='
  targetValue?: number
}

export interface MetricListResponse {
  data: Metric[]
}

export interface KPIListResponse {
  data: KPI[]
}

export interface KPIDetailResponse {
  data: KPI
}
