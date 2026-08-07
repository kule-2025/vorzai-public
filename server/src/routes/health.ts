/**
 * 健康检查路由
 * 挂载点：/api/health
 */
import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';

const router = Router();

// GET /api/health
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const result = db.prepare('SELECT 1 as health').get() as { health: number };
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      health: result.health,
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: String(error),
    });
  }
});

export default router;
