/**
 * 人力系统对接模块
 * 功能：对接企业 HR 系统（钉钉、企业微信、飞书等）
 * 接口：/api/v1/hr/employees, /api/v1/hr/attendance, /api/v1/hr/performance, /api/v1/hr/payroll
 */
import { moduleBus } from '@api/moduleBus';

export interface Employee {
  id: string;
  name: string;
  department: string;
  position: string;
  email: string;
  phone: string;
  status: 'active' | 'inactive';
  joinDate: string;
}

export interface Attendance {
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  status: 'normal' | 'late' | 'absent' | 'early-leave';
}

export interface Performance {
  employeeId: string;
  period: string;
  score: number;
  level: 'A' | 'B' | 'C' | 'D';
  comments: string;
}

export interface Payroll {
  employeeId: string;
  period: string;
  base: number;
  bonus: number;
  deductions: number;
  total: number;
  paid: boolean;
}

// ────────── 员工数据库 ──────────

let employees: Employee[] = [
  { id: 'emp-001', name: '张明', department: '运营部', position: '运营主管', email: 'zhangming@vorzai.com', phone: '138****1001', status: 'active', joinDate: '2025-01-15' },
  { id: 'emp-002', name: '李婷', department: '电商部', position: '店铺运营', email: 'liting@vorzai.com', phone: '138****1002', status: 'active', joinDate: '2025-03-20' },
  { id: 'emp-003', name: '王磊', department: '客服部', position: '客服专员', email: 'wanglei@vorzai.com', phone: '138****1003', status: 'active', joinDate: '2025-06-10' },
  { id: 'emp-004', name: '赵丽', department: '人力资源部', position: 'HR专员', email: 'zhaoli@vorzai.com', phone: '138****1004', status: 'active', joinDate: '2024-11-01' },
  { id: 'emp-005', name: '刘洋', department: '电商部', position: '数据分析', email: 'liuyang@vorzai.com', phone: '138****1005', status: 'inactive', joinDate: '2024-08-25' },
];

let attendance: Attendance[] = [
  { employeeId: 'emp-001', date: '2026-07-23', clockIn: '08:52', clockOut: '18:05', status: 'normal' },
  { employeeId: 'emp-002', date: '2026-07-23', clockIn: '09:15', clockOut: '18:30', status: 'late' },
  { employeeId: 'emp-003', date: '2026-07-23', clockIn: '09:02', clockOut: '17:58', status: 'normal' },
  { employeeId: 'emp-004', date: '2026-07-23', clockIn: '08:45', clockOut: '18:10', status: 'normal' },
  { employeeId: 'emp-001', date: '2026-07-22', clockIn: '08:50', clockOut: '18:00', status: 'normal' },
  { employeeId: 'emp-003', date: '2026-07-22', clockIn: '09:30', clockOut: '12:00', status: 'early-leave' },
];

let performances: Performance[] = [
  { employeeId: 'emp-001', period: '2026-Q2', score: 92, level: 'A', comments: '运营策略出色，转化率提升明显' },
  { employeeId: 'emp-002', period: '2026-Q2', score: 85, level: 'B', comments: '店铺运营稳定，需加强数据驱动' },
  { employeeId: 'emp-003', period: '2026-Q2', score: 78, level: 'C', comments: '客服响应及时，需提升一次性解决率' },
  { employeeId: 'emp-004', period: '2026-Q2', score: 95, level: 'A', comments: 'HR 三支柱体系搭建出色' },
];

let payrolls: Payroll[] = [
  { employeeId: 'emp-001', period: '2026-07', base: 12000, bonus: 2000, deductions: 800, total: 13200, paid: false },
  { employeeId: 'emp-002', period: '2026-07', base: 9000, bonus: 800, deductions: 600, total: 9200, paid: false },
  { employeeId: 'emp-003', period: '2026-07', base: 6000, bonus: 300, deductions: 300, total: 6000, paid: false },
  { employeeId: 'emp-004', period: '2026-07', base: 10000, bonus: 1500, deductions: 500, total: 11000, paid: false },
];

export const hrModule = {
  /** 获取员工列表 */
  getEmployees: async (filters?: { department?: string; status?: string }): Promise<Employee[]> => {
    let result = [...employees];
    if (filters?.department) result = result.filter((e) => e.department === filters.department);
    if (filters?.status) result = result.filter((e) => e.status === filters.status);
    return result;
  },

  /** 获取员工详情 */
  getEmployee: async (employeeId: string): Promise<Employee | null> => {
    return employees.find((e) => e.id === employeeId) || null;
  },

  /** 创建员工 */
  addEmployee: async (emp: Omit<Employee, 'id' | 'status'>): Promise<{ success: boolean; employee?: Employee; error?: string }> => {
    if (!emp.name || !emp.department) return { success: false, error: '姓名和部门为必填项' };
    const id = `emp-${Date.now()}`;
    const employee: Employee = { ...emp, id, status: 'active' };
    employees.push(employee);
    moduleBus.broadcast('hr:employee-added', { employeeId: id });
    return { success: true, employee };
  },

  /** 获取考勤数据 */
  getAttendance: async (employeeId: string, startDate: string, endDate: string): Promise<Attendance[]> => {
    return attendance.filter((a) =>
      a.employeeId === employeeId &&
      a.date >= startDate &&
      a.date <= endDate,
    );
  },

  /** 获取绩效数据 */
  getPerformance: async (employeeId: string, period?: string): Promise<Performance | null> => {
    if (period) {
      return performances.find((p) => p.employeeId === employeeId && p.period === period) || null;
    }
    // 返回最新一期
    return performances.find((p) => p.employeeId === employeeId) || null;
  },

  /** 获取薪资数据 */
  getPayroll: async (employeeId: string, period?: string): Promise<Payroll | null> => {
    if (period) {
      return payrolls.find((p) => p.employeeId === employeeId && p.period === period) || null;
    }
    return payrolls.find((p) => p.employeeId === employeeId) || null;
  },

  /** 获取全部薪资（管理员） */
  getAllPayrolls: async (period?: string): Promise<Payroll[]> => {
    if (period) return payrolls.filter((p) => p.period === period);
    return [...payrolls];
  },

  /** 同步 HR 数据到业务系统 */
  syncToBusiness: async (): Promise<{ success: boolean; count: number; timestamp: string }> => {
    const now = new Date().toISOString();
    moduleBus.broadcast('hr:sync-complete', { timestamp: now });
    return { success: true, count: employees.length, timestamp: now };
  },
};
