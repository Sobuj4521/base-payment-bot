class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
  }

  start(operation) {
    this.startTimes.set(operation, Date.now());
  }

  end(operation) {
    const endTime = Date.now();
    const startTime = this.startTimes.get(operation);
    
    if (startTime) {
      const duration = endTime - startTime;
      this.metrics.set(operation, duration);
      this.startTimes.delete(operation);
      
      if (duration > 100) {
        console.log(`🐢 Slow operation: ${operation} - ${duration}ms`);
      }
    }
  }

  getMetrics() {
    return Array.from(this.metrics.entries());
  }

  clear() {
    this.metrics.clear();
    this.startTimes.clear();
  }
}

const perfMonitor = new PerformanceMonitor();

function performanceMiddleware(ctx, next) {
  const operation = `${ctx.updateType}_${ctx.updateSubTypes?.[0] || 'message'}`;
  perfMonitor.start(operation);
  
  ctx.perf = perfMonitor;
  
  next().then(() => {
    perfMonitor.end(operation);
  }).catch(err => {
    perfMonitor.end(operation);
    throw err;
  });
}

module.exports = { perfMonitor, performanceMiddleware };