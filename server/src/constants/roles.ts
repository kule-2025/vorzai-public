/**
 * 统一角色层级常量（单一真相源）
 *
 * 取代 `middleware/auth.ts` 的 `ROLE_HIERARCHY` 与 `routes/tenant.ts` 的 `ROLE_LEVEL`，
 * 消除两套尺度不一致（owner:100 vs owner:5）导致的越权判定漂移风险。
 *
 * 数值越大权限越高；RBAC 比较一律使用 `roleLevel()` / `canAssignRole()`。
 */
export const ROLE_LEVELS: Record<string, number> = {
  owner: 100,
  admin: 80,
  manager: 60,
  member: 40,
  viewer: 20,
};

export type RoleName = keyof typeof ROLE_LEVELS;

export const ROLE_NAMES = Object.keys(ROLE_LEVELS) as RoleName[];

/** 取角色层级，未知角色返回 0（最低） */
export function roleLevel(role: string): number {
  return ROLE_LEVELS[role] ?? 0;
}

/**
 * 判断 operator 是否有权将目标角色赋予/提升到 targetRole。
 * 用于防越权提升：操作者层级必须 >= 目标层级。
 */
export function canAssignRole(operatorRole: string, targetRole: string): boolean {
  return roleLevel(operatorRole) >= roleLevel(targetRole);
}
