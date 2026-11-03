/**
 * Unthrottled timer utility using an inline Web Worker with window.setInterval fallback.
 *
 * Browsers (Chrome, Edge, Firefox, Safari) clamp or pause window.setInterval in
 * background/minimized tabs. Timers running inside a Web Worker are not throttled
 * by the main window's tab visibility state, allowing live polling to continue
 * accurately in the background.
 */

export interface LiveTimerHandle {
  stop: () => void;
}

export function startLiveTimer(callback: () => void, intervalMs: number): LiveTimerHandle {
  if (intervalMs <= 0) {
    return { stop: () => {} };
  }

  // Attempt to use a Web Worker for unthrottled background execution
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const blobCode = `
        let timerId = null;
        self.onmessage = function(e) {
          if (e.data && e.data.action === 'start') {
            if (timerId) clearInterval(timerId);
            timerId = setInterval(function() {
              self.postMessage('tick');
            }, e.data.interval);
          } else if (e.data && e.data.action === 'stop') {
            if (timerId) {
              clearInterval(timerId);
              timerId = null;
            }
          }
        };
      `;
      const blob = new Blob([blobCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      worker.onmessage = (e) => {
        if (e.data === 'tick') {
          try {
            callback();
          } catch (err) {
            console.error('[LiveTimer] Error in timer callback:', err);
          }
        }
      };

      worker.postMessage({ action: 'start', interval: intervalMs });

      return {
        stop: () => {
          try {
            worker.postMessage({ action: 'stop' });
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
          } catch {
            // Already terminated
          }
        }
      };
    } catch (err) {
      console.warn('[LiveTimer] Web Worker initialization failed, falling back to setInterval:', err);
    }
  }

  // Fallback to standard setInterval
  const intervalId = setInterval(() => {
    try {
      callback();
    } catch (err) {
      console.error('[LiveTimer] Error in fallback timer callback:', err);
    }
  }, intervalMs);

  return {
    stop: () => clearInterval(intervalId)
  };
}
