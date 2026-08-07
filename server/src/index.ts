import http from 'http';
import { createApp } from './app';
import { initDatabase, closeDatabase } from './db';
import { config } from './config';
import { logger } from './utils/logger';

let server: http.Server | null = null;

/**
 * Start the Vorzai API server.
 * Called from Electron main process or standalone.
 */
export function startServer(options?: { port?: number; dbPath?: string }): Promise<http.Server> {
  const port = options?.port || config.server.port;
  const host = config.server.host;

  // Initialize database
  initDatabase(options?.dbPath);

  // Create Express app
  const app = createApp();

  return new Promise((resolve, reject) => {
    server = http.createServer(app);

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error('server', `Port ${port} is already in use`);
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(error);
      }
    });

    server.listen(port, host, () => {
      logger.info('server', `Vorzai API server running at http://${host}:${port}`);
      resolve(server!);
    });
  });
}

/**
 * Gracefully stop the server.
 * Handles Node 22+ keep-alive connections that would otherwise
 * prevent server.close() from completing (causing test hangs).
 */
export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    // Node 18.2+: 先关闭空闲 keep-alive 连接，避免 close 回调永不触发
    if (typeof (server as any).closeIdleConnections === 'function') {
      (server as any).closeIdleConnections();
    }

    // 强制超时保护：3 秒后无论如何强制关闭所有连接
    const forceTimeout = setTimeout(() => {
      logger.warn('server', 'Forcing server shutdown after timeout');
      if (server) {
        // 销毁所有活跃连接
        (server as any).closeAllConnections?.();
        server = null;
      }
      closeDatabase();
      resolve();
    }, 3000);

    server.close(() => {
      clearTimeout(forceTimeout);
      closeDatabase();
      logger.info('server', 'Server stopped gracefully');
      server = null;
      resolve();
    });
  });
}

// Standalone execution (for development without Electron)
if (require.main === module) {
  startServer()
    .then(() => {
      console.log(`\n  Vorzai API Server`);
      console.log(`  http://${config.server.host}:${config.server.port}`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}\n`);
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await stopServer();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopServer();
    process.exit(0);
  });
}
