/**
 * Vorzai API Client
 * 统一的后端API调用层，替代原有的内存模拟数据
 */

const API_BASE = 'http://127.0.0.1:19527/api';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  message?: string;
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    // Load tokens from storage
    this.accessToken = localStorage.getItem('vorzai_access_token');
    this.refreshToken = localStorage.getItem('vorzai_refresh_token');
  }

  setTokens(access: string, refresh: string): void {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('vorzai_access_token', access);
    localStorage.setItem('vorzai_refresh_token', refresh);
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('vorzai_access_token');
    localStorage.removeItem('vorzai_refresh_token');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * 公共调用入口。
   * 供 src/api/<domain>.ts 独立 API 模块使用，避免各业务域都往 client.ts 里挤命名空间。
   * 语义与内部 request 完全一致（自动带 token、自动刷新、统一 ApiResponse 包装）。
   */
  async call<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(method, path, body);
  }

  /**
   * SSE 流式请求。逐条解析 `event:` / `data:` 帧并回调。
   * 与 request 不同：不做自动 refresh 重试（流已开始无法重放），401 直接回调 error。
   */
  private async streamRequest(
    path: string,
    body: unknown,
    onEvent: (event: string, data: any) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      onEvent('error', { message: `网络连接失败: ${String(error)}` });
      return;
    }

    if (!response.ok || !response.body) {
      let msg = `HTTP ${response.status}`;
      try {
        const j = await response.json();
        msg = j?.error?.message || msg;
      } catch { /* 响应非 JSON，沿用状态码 */ }
      onEvent('error', { message: msg });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 以空行分帧
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!frame.trim() || frame.startsWith(':')) continue; // 心跳

          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          try {
            onEvent(eventName, JSON.parse(dataLines.join('\n')));
          } catch {
            onEvent(eventName, { raw: dataLines.join('\n') });
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        onEvent('error', { message: `流读取中断: ${String(error)}` });
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, retryCount = 0): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      // Handle token expiry - try refresh (max 1 retry to prevent infinite loop)
      if (response.status === 401 && this.refreshToken && path !== '/auth/refresh' && retryCount < 1) {
        const refreshResult = await this.request<{ accessToken: string; refreshToken: string }>(
          'POST', '/auth/refresh', { refreshToken: this.refreshToken }, 1
        );
        if (refreshResult.success && refreshResult.data) {
          this.setTokens(refreshResult.data.accessToken, refreshResult.data.refreshToken);
          return this.request<T>(method, path, body, 1);
        }
        this.clearTokens();
      }

      return data;
    } catch (error) {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: `网络连接失败: ${String(error)}` },
      };
    }
  }

  // ==================== Auth ====================
  auth = {
    register: (data: { username: string; password: string; displayName: string; email?: string; tenantName?: string }) =>
      this.request<{ user: any; tokens: { accessToken: string; refreshToken: string } }>('POST', '/auth/register', data),

    login: (data: { username: string; password: string }) =>
      this.request<{ user: any; tokens: { accessToken: string; refreshToken: string } }>('POST', '/auth/login', data),

    logout: () => this.request('POST', '/auth/logout'),

    getProfile: () => this.request<any>('GET', '/auth/profile'),

    changePassword: (data: { oldPassword: string; newPassword: string }) =>
      this.request('PUT', '/auth/password', data),
  };

  // ==================== OGSM ====================
  ogsm = {
    createObjective: (data: any) => this.request('POST', '/ogsm/objectives', data),
    listObjectives: (params?: Record<string, any>) =>
      this.request('GET', `/ogsm/objectives?${new URLSearchParams(params || {})}`),
    getObjective: (id: string) => this.request('GET', `/ogsm/objectives/${id}`),
    getObjectiveTree: (id: string) => this.request('GET', `/ogsm/objectives/${id}/tree`),
    updateObjective: (id: string, data: any) => this.request('PUT', `/ogsm/objectives/${id}`, data),
    deleteObjective: (id: string) => this.request('DELETE', `/ogsm/objectives/${id}`),

    createGoal: (data: any) => this.request('POST', '/ogsm/goals', data),
    listGoals: (objectiveId: string) => this.request('GET', `/ogsm/objectives/${objectiveId}/goals`),
    updateGoalProgress: (id: string, currentValue: number) =>
      this.request('PUT', `/ogsm/goals/${id}/progress`, { currentValue }),

    createStrategy: (data: any) => this.request('POST', '/ogsm/strategies', data),
    listStrategies: (goalId: string) => this.request('GET', `/ogsm/goals/${goalId}/strategies`),

    createMeasure: (data: any) => this.request('POST', '/ogsm/measures', data),
    listMeasures: (strategyId: string) => this.request('GET', `/ogsm/strategies/${strategyId}/measures`),

    setRaci: (data: any) => this.request('POST', '/ogsm/raci', data),
    getRaciMatrix: (entityType: string, entityId: string) =>
      this.request('GET', `/ogsm/raci/${entityType}/${entityId}`),

    createIncentive: (data: any) => this.request('POST', '/ogsm/incentives', data),
    listIncentives: (params?: Record<string, any>) =>
      this.request('GET', `/ogsm/incentives?${new URLSearchParams(params || {})}`),

    // OGSM 时间序列追踪（V2 O2-O4）
    getTimeSeries: (objectiveId: string, from: string, to: string) =>
      this.request('GET', `/ogsm-tracking/snapshots/time-series?${new URLSearchParams({ objective_id: objectiveId, from, to })}`),
    getTenantOverview: (days: number = 30) =>
      this.request('GET', `/ogsm-tracking/snapshots/tenant-overview?days=${days}`),
    captureDailySnapshots: (snapshotDate?: string) =>
      this.request('POST', '/ogsm-tracking/snapshots/daily-capture', { snapshotDate }),
    listDeviations: (params?: { acknowledged?: boolean; severity?: string }) =>
      this.request('GET', `/ogsm-tracking/deviations?${new URLSearchParams(params as Record<string, string> || {})}`),
    scanDeviations: (snapshotDate?: string) =>
      this.request('POST', '/ogsm-tracking/deviations/scan', { snapshotDate }),
    acknowledgeDeviation: (id: string) =>
      this.request('POST', `/ogsm-tracking/deviations/${id}/acknowledge`, {}),
    listMetricLinks: (goalId?: string) =>
      this.request('GET', `/ogsm-tracking/metric-links?${new URLSearchParams(goalId ? { goal_id: goalId } : {})}`),
    createMetricLink: (data: any) => this.request('POST', '/ogsm-tracking/metric-links', data),
    syncMetricLink: (id: string) => this.request('POST', `/ogsm-tracking/metric-links/${id}/sync`, {}),
    syncAllMetricLinks: () => this.request('POST', '/ogsm-tracking/metric-links/sync-all', {}),
    deleteMetricLink: (id: string) => this.request('DELETE', `/ogsm-tracking/metric-links/${id}`),

    // Dashboard / Analytics
    getOGSMStats: () => this.request('GET', '/ogsm/stats'),
    getObjectiveProgress: (id: string) => this.request('GET', `/ogsm/objectives/${id}/progress`),
    getGoalAlignment: (id: string) => this.request('GET', `/ogsm/goals/${id}/alignment`),
    getRACIMatrix: () => this.request('GET', '/ogsm/raci'),
    // ── V2 RACI 增强（R1-R5）──
    checkAUniqueness: (entityType: string, entityId: string) =>
      this.request('GET', `/ogsm/raci/check-a/${entityType}/${entityId}`),
    findDuplicateAs: () => this.request('GET', '/ogsm/raci/duplicate-as'),
    findUncovered: () => this.request('GET', '/ogsm/raci/uncovered'),
    getLoadStats: () => this.request('GET', '/ogsm/raci/load'),
    getMyResponsibilities: (userId: string) =>
      this.request('GET', `/ogsm/raci/my-responsibilities?userId=${userId}`),
    getAlignmentChain: (entityType: string, entityId: string) =>
      this.request('GET', `/ogsm/raci/alignment-chain/${entityType}/${entityId}`),
    getIncentiveSummary: () => this.request('GET', '/ogsm/incentives/summary'),
  };

  // ==================== Incentive Rule Engine (V2 I1-I2) ====================
  incentive = {
    listRules: (params?: Record<string, any>) =>
      this.request('GET', `/incentives/rules?${new URLSearchParams(params || {})}`),
    getRule: (id: string) =>
      this.request('GET', `/incentives/rules/${id}`),
    createRule: (data: any) => this.request('POST', '/incentives/rules', data),
    updateRule: (id: string, data: any) => this.request('PUT', `/incentives/rules/${id}`, data),
    deleteRule: (id: string) => this.request('DELETE', `/incentives/rules/${id}`),
    calcPeriod: (period: string) => this.request('POST', `/incentives/calc/${period}`),
    getCalcSummary: (period: string) => this.request('GET', `/incentives/calc/${period}/summary`),
  };

  // ==================== Workflow Orchestration (W5) ====================
  workflow = {
    list: (status?: string) =>
      this.request('GET', `/workflows?${status ? new URLSearchParams({ status } as Record<string, string>) : ''}`),
    create: (data: { name: string; description?: string }) =>
      this.request('POST', '/workflows', data),
    get: (id: string) => this.request('GET', `/workflows/${id}`),
    getGraph: (id: string) => this.request('GET', `/workflows/${id}/graph`),
    validate: (id: string) => this.request('POST', `/workflows/${id}/validate`),
    listRuns: (id: string, status?: string) =>
      this.request('GET', `/workflows/${id}/runs?${status ? new URLSearchParams({ status } as Record<string, string>) : ''}`),
    run: (id: string, inputs?: Record<string, unknown>) =>
      this.request('POST', `/workflows/${id}/runs`, { inputs: inputs ?? {}, triggered_by_type: 'manual' }),
    cancelRun: (id: string, runId: string) =>
      this.request('POST', `/workflows/${id}/runs/${runId}/cancel`),
    getRun: (id: string, runId: string) =>
      this.request('GET', `/workflows/${id}/runs/${runId}`),
    tools: () => this.request('GET', '/workflows/tools/registry'),
  };

  // ==================== HR ====================
  hr = {
    createEmployee: (data: any) => this.request('POST', '/hr/employees', data),
    listEmployees: (params?: Record<string, any>) =>
      this.request('GET', `/hr/employees?${new URLSearchParams(params || {})}`),
    getEmployee: (id: string) => this.request('GET', `/hr/employees/${id}`),
    updateEmployee: (id: string, data: any) => this.request('PUT', `/hr/employees/${id}`, data),
    deleteEmployee: (id: string) => this.request('DELETE', `/hr/employees/${id}`),

    listDepartments: () => this.request('GET', '/hr/departments'),
    createDepartment: (data: any) => this.request('POST', '/hr/departments', data),

    recordAttendance: (data: any) => this.request('POST', '/hr/attendance', data),
    getAttendance: (params?: Record<string, any>) =>
      this.request('GET', `/hr/attendance?${new URLSearchParams(params || {})}`),
    getAttendanceSummary: (period: string) => this.request('GET', `/hr/attendance/summary/${period}`),
    calculateAttendance: (data: { employeeId: string; startDate: string; endDate: string }) =>
      this.request('POST', '/hr/attendance/calculate', data),

    createPerformance: (data: any) => this.request('POST', '/hr/performance', data),
    listPerformance: (params?: Record<string, any>) =>
      this.request('GET', `/hr/performance?${new URLSearchParams(params || {})}`),
    calculatePerformance: (data: { employeeId: string; achievement: number; collaboration: number; innovation: number; learning: number }) =>
      this.request('POST', '/hr/performance/calculate', data),

    calculatePayroll: (data: { employeeId: string; period: string; rules?: Record<string, any> }) =>
      this.request('POST', '/hr/payroll/calculate', data),
    getPayroll: (employeeId: string, period: string) =>
      this.request('GET', `/hr/payroll/${employeeId}/${period}`),

    getEfficiency: (period: string, params?: Record<string, any>) =>
      this.request('GET', `/hr/efficiency/${period}?${new URLSearchParams(params || {})}`),
    calculateEfficiency: (data: { startDate: string; endDate: string }) =>
      this.request('POST', '/hr/efficiency/calculate', data),

    // ============ H3: 岗位绩效模型库 ============
    seedJobModels: () => this.request('POST', '/hr/job-models/seed'),
    createJobModel: (data: any) => this.request('POST', '/hr/job-models', data),
    listJobModels: (params?: Record<string, any>) =>
      this.request('GET', `/hr/job-models?${new URLSearchParams(params || {})}`),
    getJobModel: (id: string) => this.request('GET', `/hr/job-models/${id}`),
    updateJobModel: (id: string, data: any) => this.request('PATCH', `/hr/job-models/${id}`, data),
    deleteJobModel: (id: string) => this.request('DELETE', `/hr/job-models/${id}`),

    // ============ H4: 行业日历 ============
    createCalendar: (data: any) => this.request('POST', '/hr/calendars', data),
    listCalendars: (params?: Record<string, any>) =>
      this.request('GET', `/hr/calendars?${new URLSearchParams(params || {})}`),
    listUpcomingCalendars: (days?: number) =>
      this.request('GET', `/hr/calendars/upcoming${days ? `?days=${days}` : ''}`),
    updateCalendar: (id: string, data: any) => this.request('PATCH', `/hr/calendars/${id}`, data),
    deleteCalendar: (id: string) => this.request('DELETE', `/hr/calendars/${id}`),

    // ============ H5: 离职风险分析 ============
    assessRetention: (employeeId: string) => this.request('POST', `/hr/retention/assess/${employeeId}`),
    listRetentionRisks: (params?: Record<string, any>) =>
      this.request('GET', `/hr/retention/risks?${new URLSearchParams(params || {})}`),
    acknowledgeRetentionRisk: (id: string) => this.request('POST', `/hr/retention/risks/${id}/acknowledge`),

    // ============ H6: HR 战略看板 ============
    getStrategyDashboard: () => this.request('GET', '/hr/dashboard/strategy'),
  };

  // ==================== Business ====================
  business = {
    createProject: (data: any) => this.request('POST', '/business/projects', data),
    listProjects: (params?: Record<string, any>) =>
      this.request('GET', `/business/projects?${new URLSearchParams(params || {})}`),
    getProject: (id: string) => this.request('GET', `/business/projects/${id}`),
    updateProject: (id: string, data: any) => this.request('PUT', `/business/projects/${id}`, data),

    createProduct: (data: any) => this.request('POST', '/business/products', data),
    listProducts: (params?: Record<string, any>) =>
      this.request('GET', `/business/products?${new URLSearchParams(params || {})}`),
    updateProductStatus: (id: string, data: any) =>
      this.request('PUT', `/business/products/${id}/status`, data),
    updateProduct: (id: string, data: any) =>
      this.request('PUT', `/business/products/${id}`, data),

    createOrder: (data: any) => this.request('POST', '/business/orders', data),
    listOrders: (params?: Record<string, any>) =>
      this.request('GET', `/business/orders?${new URLSearchParams(params || {})}`),
    updateOrderStatus: (id: string, data: any) =>
      this.request('PUT', `/business/orders/${id}/status`, data),
    /** 登记收款/退款。amount 为正数=收款，负数=退款；支付状态由后端按累计实收自动推导 */
    recordOrderPayment: (id: string, data: { amount: number; paymentMethod?: string; remark?: string }) =>
      this.request('PUT', `/business/orders/${id}/payment`, data),
    getOrderStats: (period?: string) =>
      this.request('GET', `/business/orders/stats?${period ? `period=${period}` : ''}`),

    createTicket: (data: any) => this.request('POST', '/business/tickets', data),
    listTickets: (params?: Record<string, any>) =>
      this.request('GET', `/business/tickets?${new URLSearchParams(params || {})}`),
    getTicket: (id: string) => this.request('GET', `/business/tickets/${id}`),
    updateTicketStatus: (id: string, status: string) =>
      this.request('PUT', `/business/tickets/${id}/status`, { status }),
    addTicketMessage: (id: string, content: string) =>
      this.request('POST', `/business/tickets/${id}/messages`, { content }),
    assignTicket: (id: string, agentId: string) =>
      this.request('PUT', `/business/tickets/${id}/assign`, { agentId }),
    escalateTicket: (id: string, reason?: string) =>
      this.request('PUT', `/business/tickets/${id}/escalate`, { reason }),

    // 组盘管理
    createAssortment: (data: any) => this.request('POST', '/business/assortment', data),
    getAssortments: (params?: Record<string, any>) =>
      this.request('GET', `/business/assortments?${new URLSearchParams(params || {})}`),
    getAssortment: (id: string) => this.request('GET', `/business/assortments/${id}`),
    updateAssortment: (id: string, data: any) =>
      this.request('PUT', `/business/assortments/${id}`, data),
    deleteAssortment: (id: string) => this.request('DELETE', `/business/assortments/${id}`),
    addProductToAssortment: (id: string, data: any) =>
      this.request('PUT', `/business/assortments/${id}/products`, data),
    removeProductFromAssortment: (id: string, productId: string) =>
      this.request('DELETE', `/business/assortments/${id}/products/${productId}`),
    previewAssortment: (id: string) =>
      this.request('GET', `/business/assortments/${id}/preview`),

    // 批量导入
    batchImportProducts: (csv: string) =>
      this.request('POST', '/business/import/products', { csv }),
    batchImportOrders: (csv: string) =>
      this.request('POST', '/business/import/orders', { csv }),

    // 大促活动
    createCampaign: (data: any) => this.request('POST', '/business/campaigns', data),
    listCampaigns: (params?: Record<string, any>) =>
      this.request('GET', `/business/campaigns?${new URLSearchParams(params || {})}`),
    getCampaign: (id: string) => this.request('GET', `/business/campaigns/${id}`),
    updateCampaign: (id: string, data: any) =>
      this.request('PUT', `/business/campaigns/${id}`, data),
    deleteCampaign: (id: string) => this.request('DELETE', `/business/campaigns/${id}`),
    addProductToCampaign: (id: string, data: any) =>
      this.request('PUT', `/business/campaigns/${id}/products`, data),
    removeProductFromCampaign: (id: string, productId: string) =>
      this.request('DELETE', `/business/campaigns/${id}/products/${productId}`),

    // 投流记录
    createAdSpend: (data: any) => this.request('POST', '/business/ad-spend', data),
    listAdSpend: (params?: Record<string, any>) =>
      this.request('GET', `/business/ad-spend?${new URLSearchParams(params || {})}`),
    getAdSpend: (id: string) => this.request('GET', `/business/ad-spend/${id}`),
    getAdSpendSummary: (params?: Record<string, any>) =>
      this.request('GET', `/business/ad-spend/summary?${new URLSearchParams(params || {})}`),

    // 评价管理
    createReview: (data: any) => this.request('POST', '/business/reviews', data),
    listReviews: (params?: Record<string, any>) =>
      this.request('GET', `/business/reviews?${new URLSearchParams(params || {})}`),
    approveReview: (id: string) => this.request('PUT', `/business/reviews/${id}/approve`, {}),
    replyToReview: (id: string, data: { reply: string; userId: string }) =>
      this.request('PUT', `/business/reviews/${id}/reply`, data),
    getProductReviewStats: (productId: string) =>
      this.request('GET', `/business/products/${productId}/review-stats`),

    // 结算
    createSettlement: (data: any) => this.request('POST', '/business/settlements', data),
    listSettlements: (params?: Record<string, any>) =>
      this.request('GET', `/business/settlements?${new URLSearchParams(params || {})}`),

    // C1: 退货闭环
    createReturn: (data: any) => this.request('POST', '/business/returns', data),
    listReturns: (params?: Record<string, any>) =>
      this.request<any[]>('GET', `/business/returns?${new URLSearchParams(params || {})}`),
    getReturn: (id: string) => this.request<any>('GET', `/business/returns/${id}`),
    approveReturn: (id: string, data?: { note?: string }) =>
      this.request<any>('POST', `/business/returns/${id}/approve`, data || {}),
    rejectReturn: (id: string, data?: { note?: string }) =>
      this.request<any>('POST', `/business/returns/${id}/reject`, data || {}),
    receiveReturn: (id: string) =>
      this.request<any>('POST', `/business/returns/${id}/receive`, {}),
    processRefund: (id: string) =>
      this.request<any>('POST', `/business/returns/${id}/refund`, {}),

    // C2: 客户标签
    addCustomerTag: (data: { customerId: string; tag: string; category?: string; score?: number; source?: string }) =>
      this.request<any>('POST', '/business/customer-tags', data),
    listCustomerTags: (customerId?: string) =>
      this.request<any[]>('GET', `/business/customer-tags?${customerId ? `customerId=${customerId}` : ''}`),
    removeCustomerTag: (id: string) =>
      this.request<any>('DELETE', `/business/customer-tags/${id}`),
    getCustomerSegments: () =>
      this.request<any[]>('GET', '/business/customer-segments'),

    // C3: 转化分析
    analyzeConversion: (from: string, to: string) =>
      this.request<any>('GET', `/business/conversion-analysis?from=${from}&to=${to}`),
  };

  // ==================== Knowledge & Skills ====================
  knowledge = {
    createKnowledgeBase: (data: any) => this.request('POST', '/knowledge-bases', data),
    listKnowledgeBases: () => this.request('GET', '/knowledge-bases'),
    createDocument: (kbId: string, data: any) => this.request('POST', `/knowledge-bases/${kbId}/documents`, data),
    uploadDocument: (kbId: string, data: { name: string; content: string; mimeType: string; category?: string; tags?: string[] }) =>
      this.request('POST', `/knowledge-bases/${kbId}/documents`, data),
    listDocuments: (kbId: string, params?: Record<string, any>) =>
      this.request('GET', `/knowledge-bases/${kbId}/documents?${new URLSearchParams(params || {})}`),
    getDocument: (kbId: string, docId: string) => this.request('GET', `/knowledge-bases/${kbId}/documents/${docId}`),
    deleteDocument: (kbId: string, docId: string) => this.request('DELETE', `/knowledge-bases/${kbId}/documents/${docId}`),
    search: (query: string) => this.request('GET', `/knowledge/search?q=${encodeURIComponent(query)}`),
    searchKnowledge: (query: string, options?: { knowledgeBaseId?: string; limit?: number }) =>
      this.request('POST', '/knowledge/search', { query, ...options }),
  };

  skills = {
    create: (data: any) => this.request('POST', '/skills', data),
    list: (params?: Record<string, any>) =>
      this.request('GET', `/skills?${new URLSearchParams(params || {})}`),
    execute: (id: string, input: Record<string, unknown>) =>
      this.request('POST', `/skills/${id}/execute`, input),
    generateFromDocument: (kbId: string, docId: string, skillName: string) =>
      this.request('POST', `/knowledge-bases/${kbId}/documents/${docId}/generate-skill`, { skillName }),
    getEnterpriseSkills: () => this.request('GET', '/skills/enterprise'),
  };

  connectors = {
    create: (data: any) => this.request('POST', '/connectors', data),
    list: () => this.request('GET', '/connectors'),
    updateStatus: (id: string, data: any) => this.request('PUT', `/connectors/${id}/status`, data),
    sync: (id: string, syncType?: string) => this.request('POST', `/connectors/${id}/sync`, { syncType: syncType || 'full' }),
  };

  emailConnectors = {
    create: (data: { name: string; provider: 'smtp' | 'imap' | 'api'; config: { host: string; port: number; username: string; password: string; ssl?: boolean; tls?: boolean }; emailAddress?: string }) =>
      this.request('POST', '/connectors/email', data),
    list: () => this.request('GET', '/connectors/email'),
    get: (id: string) => this.request('GET', `/connectors/email/${id}`),
    update: (id: string, data: { name?: string; config?: Record<string, unknown>; emailAddress?: string }) =>
      this.request('PUT', `/connectors/email/${id}`, data),
    delete: (id: string) => this.request('DELETE', `/connectors/email/${id}`),
    connect: (id: string) => this.request('POST', `/connectors/email/${id}/connect`),
    sync: (id: string) => this.request('POST', `/connectors/email/${id}/sync`),
    send: (id: string, data: { to: string; subject: string; body: string }) =>
      this.request('POST', `/connectors/email/${id}/send`, data),
    logs: (id: string) => this.request('GET', `/connectors/email/${id}/logs`),
  };

  delegatedPermissions = {
    list: (type?: 'granted' | 'given') =>
      this.request('GET', `/auth/delegated-permissions${type ? `?type=${type}` : ''}`),
    create: (data: { delegateeId: string; scope: string; permissionPoint: string; expiresAt?: string }) =>
      this.request('POST', '/auth/delegated-permissions', data),
    revoke: (id: string) => this.request('DELETE', `/auth/delegated-permissions/${id}`),
    check: (data: { userId: string; resource: string; action: string }) =>
      this.request('POST', '/auth/permissions/check', data),
  };

  // ==================== Agents ====================
  agents = {
    list: () => this.request('GET', '/agents'),
    get: (id: string) => this.request('GET', `/agents/${id}`),
    create: (data: any) => this.request('POST', '/agents', data),
    update: (id: string, data: any) => this.request('PUT', `/agents/${id}`, data),
    start: (id: string) => this.request('POST', `/agents/${id}/start`),
    stop: (id: string) => this.request('POST', `/agents/${id}/stop`),
    remove: (id: string) => this.request('DELETE', `/agents/${id}`),
  };

  // ==================== LLM Platforms ====================
  llm = {
    list: () => this.request('GET', '/llm'),
    get: (id: string) => this.request('GET', `/llm/${id}`),
    create: (data: any) => this.request('POST', '/llm', data),
    update: (id: string, data: any) => this.request('PUT', `/llm/${id}`, data),
    remove: (id: string) => this.request('DELETE', `/llm/${id}`),
  };

  // ==================== Chat ====================
  chat = {
    createConversation: (data?: any) => this.request('POST', '/chat/conversations', data),
    listConversations: () => this.request('GET', '/chat/conversations'),
    getMessages: (conversationId: string) => this.request('GET', `/chat/conversations/${conversationId}/messages`),
    send: (data: { message: string; conversationId?: string; contextType?: string }) =>
      this.request('POST', '/chat/send', data),
  };

  // ==================== Health ====================
  health = () => this.request('GET', '/health');

  // ==================== 调休与休假 ====================
  leave = {
    getTypes: () => this.request('GET', '/leave/types'),
    createOvertime: (data: { employee_id: string; date: string; start_time: string; end_time: string; hours: number; reason?: string }) =>
      this.request('POST', '/leave/overtime', data),
    getOvertime: (id: string) => this.request('GET', `/leave/overtime/${id}`),
    listOvertime: (employeeId: string, year?: number) =>
      this.request<any[]>('GET', `/leave/overtime/employee/${employeeId}${year ? `?year=${year}` : ''}`),
    approveOvertime: (id: string, status: 'approved' | 'rejected', rejected_reason?: string) =>
      this.request('POST', `/leave/overtime/${id}/approve`, { status, rejected_reason }),
    listPendingOvertime: () => this.request<any[]>('GET', '/leave/overtime-pending'),
    getBalances: (employeeId: string, year?: number) =>
      this.request('GET', `/leave/balances/${employeeId}${year ? `?year=${year}` : ''}`),
    checkCompensatory: (employeeId: string, hours: number) =>
      this.request<{ sufficient: boolean; remaining: number; deficit: number }>('GET', `/leave/balances/${employeeId}/check-compensatory?hours=${hours}`),
    getCompensatorySummary: (employeeId: string, year?: number) =>
      this.request<{
        employee_id: string; year: number; totalHours: number; usedHours: number; effectiveRemaining: number;
        expiringSoon: Array<{ hours: number; expiresAt: string; daysLeft: number }>;
        ledger: Array<{ date: string; type: 'accrual' | 'consume'; hours: number; refId: string; note: string }>;
      }>('GET', `/leave/compensatory-summary/${employeeId}${year ? `?year=${year}` : ''}`),
    applyLeave: (data: { employee_id: string; leave_type_id: string; start_datetime: string; end_datetime: string; total_hours: number; reason?: string; overtime_record_id?: string }) =>
      this.request('POST', '/leave/applications', data),
    getApplication: (id: string) => this.request('GET', `/leave/applications/${id}`),
    listApplications: (employeeId: string, year?: number) =>
      this.request<any[]>('GET', `/leave/applications/employee/${employeeId}${year ? `?year=${year}` : ''}`),
    approveLeave: (id: string, status: 'approved' | 'rejected', rejected_reason?: string) =>
      this.request('POST', `/leave/applications/${id}/approve`, { status, rejected_reason }),
    cancelLeave: (id: string) => this.request('POST', `/leave/applications/${id}/cancel`),
    listPendingApplications: () => this.request<any[]>('GET', '/leave/applications-pending'),
    carryOver: (from_year?: number, carry_over_hours?: number) =>
      this.request<{ carried_over_count: number; from_year: number; to_year: number }>('POST', '/leave/carry-over', { from_year, carry_over_hours }),
  };

  // ==================== Cockpit (业务驾驶舱) ====================
  cockpit = {
    getOverview: () => this.request<{
      generatedAt: string;
      kpi: {
        todayGmv: number;
        todayOrderCount: number;
        monthlyGrossProfit: number;
        monthlyRevenue: number;
        monthlyCost: number;
        activeOrderCount: number;
        openTicketCount: number;
        lowStockSkuCount: number;
      };
      funnel: Array<{
        id: string;
        label: string;
        count: number;
        conversionRate: number;
      }>;
      topAbnormal: Array<{
        id: string;
        label: string;
        empty?: boolean;
        reason?: string;
        items: Array<{
          id: string;
          name: string;
          value: number;
          meta?: string;
          href?: string;
        }>;
      }>;
      bizLines: Array<{
        id: string;
        label: string;
        gmv: number;
        orderCount: number;
        paidOrderCount: number;
        conversionRate: number;
        platformValue: string;
      }>;
    }>('GET', '/cockpit/overview'),
  };

  // ==================== Tenant Admin ====================
  tenant = {
    listUsers: (params?: { q?: string; role?: string; status?: string }) => {
      const qs = new URLSearchParams(
        Object.entries(params || {}).filter(([, v]) => v) as [string, string][]
      ).toString();
      return this.request<any[]>('GET', `/tenant/users${qs ? `?${qs}` : ''}`);
    },
    getUserStats: () => this.request<{
      total: number;
      active: number;
      byRole: { role: string; count: number }[];
      byStatus: { status: string; count: number }[];
    }>('GET', '/tenant/users/stats'),
    createUser: (data: {
      username: string; password: string; displayName: string;
      email?: string; phone?: string; role?: string; departmentId?: string;
    }) => this.request<any>('POST', '/tenant/users', data),
    updateUser: (id: string, data: {
      displayName?: string; email?: string; phone?: string;
      role?: string; status?: string; departmentId?: string;
    }) => this.request<any>('PATCH', `/tenant/users/${id}`, data),
    resetPassword: (id: string, password: string) =>
      this.request<any>('POST', `/tenant/users/${id}/reset-password`, { password }),
    deactivateUser: (id: string) => this.request<any>('DELETE', `/tenant/users/${id}`),
    listRoles: () => this.request<Array<{
      key: string; level: number; label: string; description: string;
      permissions: string[]; userCount: number;
    }>>('GET', '/tenant/roles'),
  };

  // ==================== Dialog ====================
  dialog = {
    chatMessage: (sessionId: string | null, message: string) =>
      this.request<any>('POST', '/dialog/chat', { sessionId, message }),
    listSessions: () => this.request<any>('GET', '/dialog/sessions'),
    createSession: (data?: { title?: string }) => this.request<any>('POST', '/dialog/sessions', data || {}),
    getSessionMessages: (sessionId: string) =>
      this.request<any>('GET', `/dialog/sessions/${sessionId}/messages`),
    deleteSession: (sessionId: string) =>
      this.request<any>('DELETE', `/dialog/sessions/${sessionId}`),

    /**
     * W3 流式对话。回调按真实服务端阶段触发：
     * session → stage → reply → action*（0..n）→ done，异常时 error。
     * 返回的 abort() 可主动中断（用户点「停止」）。
     */
    streamChat: (
      sessionId: string | null,
      message: string,
      handlers: {
        onSession?: (d: { sessionId: string }) => void;
        onStage?: (d: { stage: string; label: string }) => void;
        onReply?: (d: { messageId: string; reply: string; sources?: any[]; ragContext?: string; elapsedMs?: number }) => void;
        onAction?: (d: { type: string; status: string; result?: unknown; error?: string }) => void;
        onDone?: (d: { sessionId: string; messageId: string; elapsedMs?: number }) => void;
        onError?: (d: { message: string }) => void;
      }
    ): { promise: Promise<void>; abort: () => void } => {
      const controller = new AbortController();
      const promise = this.streamRequest(
        '/dialog/stream',
        { sessionId: sessionId || undefined, message },
        (event, data) => {
          switch (event) {
            case 'session': handlers.onSession?.(data); break;
            case 'stage':   handlers.onStage?.(data); break;
            case 'reply':   handlers.onReply?.(data); break;
            case 'action':  handlers.onAction?.(data); break;
            case 'done':    handlers.onDone?.(data); break;
            case 'error':   handlers.onError?.(data); break;
          }
        },
        controller.signal
      );
      return { promise, abort: () => controller.abort() };
    },
  };
}

export const api = new ApiClient();
export default api;
