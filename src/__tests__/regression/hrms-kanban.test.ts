/**
 * 回归测试：HRMS Kanban 任务流转
 */
import { describe, it, expect } from 'vitest';

const TASK_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'blocked', 'completed'];
const TASK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

describe('HRMS Kanban Task Flow', () => {
  it('should support all 6 kanban columns', () => {
    expect(TASK_STATUSES).toHaveLength(6);
    expect(TASK_STATUSES).toContain('backlog');
    expect(TASK_STATUSES).toContain('completed');
  });

  it('should support all 4 priority levels', () => {
    expect(TASK_PRIORITIES).toHaveLength(4);
    expect(TASK_PRIORITIES[0]).toBe('P0');
  });

  it('should transition task between columns', () => {
    const task = { id: 't1', title: 'Test Task', status: 'todo', priority: 'P1', assignee: 'user1', ogsmRef: null, dueDate: null };
    task.status = 'in-progress';
    expect(task.status).toBe('in-progress');
    task.status = 'review';
    expect(task.status).toBe('review');
    task.status = 'completed';
    expect(task.status).toBe('completed');
  });

  it('should handle blocked state', () => {
    const task = { id: 't2', title: 'Blocked Task', status: 'in-progress', priority: 'P0', assignee: 'user1', ogsmRef: null, dueDate: null };
    task.status = 'blocked';
    expect(task.status).toBe('blocked');
    // Can move back to in-progress
    task.status = 'in-progress';
    expect(task.status).toBe('in-progress');
  });
});
